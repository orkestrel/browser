import type { ChildProcess } from 'node:child_process'
import type { IncomingMessage, Server as HTTPServer, ServerResponse } from 'node:http'
import type { AddressInfo, Server as NetServer, Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import type { FileHandle } from 'node:fs/promises'
import type { NodeWebSocketInterface } from '@orkestrel/websocket'
import type { ScratchInterface } from '@orkestrel/test/server'
import type { RetryOptions, TeardownInterface } from '@orkestrel/test'
import type { MCPTransportInterface } from '@orkestrel/mcp'
import type { BrowserContextInterface, BrowserPageInterface } from '@src/core'
import type {
	BrowserConnection,
	BrowserDiscoveryResult,
	BrowserEventMap,
	BrowserInterface,
	BrowserLaunchFunction,
	BrowserOptions,
	BrowserStatus,
} from '@src/server'
import type { BrowserElementFixture, CDPSentMessage, CDPTestTransportInterface } from './setup.js'
import { spawn as spawnProcess, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createInterface } from 'node:readline'
import { PassThrough } from 'node:stream'
import { createConnection, createServer as createNetServer } from 'node:net'
import { constants, existsSync, readdirSync, readFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
	isArray,
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
import { createLoopback, createScratch, isRunning, readErrorCode } from '@orkestrel/test/server'
import {
	createTeardown,
	requireValue,
	retryUntil,
	waitForCondition,
	waitForEvent,
} from '@orkestrel/test'
import { Emitter } from '@orkestrel/emitter'
import { BrowserContext, BrowserError } from '@src/core'
import { createBrowserElementFixture, replyOk } from './setup.js'

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
			socket.on('error', () => undefined)
			socket.on('close', () => this.#sockets.delete(socket))
		})
	}

	get endpoint(): string {
		if (this.#port === undefined) throw new Error('Stall server has not started')
		return `ws://127.0.0.1:${this.#port}/cdp`
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
	const payloads: string[] = []
	let offset = 0
	while (offset < chunk.length) {
		const frame = parseWebSocketFrame(chunk.subarray(offset))
		if (frame === undefined)
			throw new Error(`The write ends inside the frame at byte ${offset} of ${chunk.length}`)
		payloads.push(frame.payload.toString('utf8'))
		offset += frame.consumed
	}
	return payloads
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
			let pid: number | undefined
			try {
				const contents = fixture.scratch.read(pidName)?.trim()
				if (contents !== undefined && contents.length > 0) pid = Number(contents)
			} catch {
				// pid file never written — nothing to kill
			}
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
 * it `\r\n`; `flood` writes 1 MB to stderr after readiness; `mute` closes the
 * serving process's stderr without printing the line and serves nothing. With none of these options the process idles (never
 * serves CDP) — useful for launch-failure/abort scenarios.
 * @returns A {@link FakeBrowserProcessInterface}
 */
export function createFakeBrowserProcess(
	options: {
		readonly serveCDP?: boolean
		readonly ignoreSIGTERM?: boolean
		readonly descendant?: boolean
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

	if (options.ignoreSIGTERM === true) {
		lines.push("process.on('SIGTERM', () => {})")
	}
	if (options.descendant === true) {
		const descendantSource = [
			`require('fs').writeFileSync(${JSON.stringify(descendantFile)}, String(process.pid))`,
			...(options.ignoreSIGTERM === true ? ["process.on('SIGTERM', () => {})"] : []),
			`const __runnerPid = ${process.pid}`,
			'setInterval(() => {',
			'\ttry { process.kill(__runnerPid, 0) } catch { process.exit(0) }',
			'}, 500)',
		].join('\n')
		lines.push(
			`require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], { stdio: 'ignore' })`,
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
		lines.push("require('fs').closeSync(2)")
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
				'let activeWS',
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
				'\t\tif (activeWS) activeWS.destroy()',
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
				'\tactiveWS = ws',
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
				'\t\tif (activeWS === ws) activeWS = undefined',
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
import { createDocumentToolset } from '/dist/src/browser/index.js'
import { createModelContext } from '@orkestrel/mcp/browser'
import { installModelContext } from '${FIXTURE_REGISTRY_MODULE}'
try {
	installModelContext(document)
	const toolset = createDocumentToolset({ document, own: true, source: createModelContext({ document }) })
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
 *   serves, and publishes `createDocumentToolset({ document, own: true, source })` over its own
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
 * imports relatively, and {@link FIXTURE_REGISTRY_MODULE}, which is `tests/fixtures/modelContext.ts`
 * with its types removed by Vite's `transformWithOxc`.
 */
export async function loadFixtureModule(
	path: string,
	root: string = FIXTURE_WORKSPACE,
): Promise<string | undefined> {
	if (path === FIXTURE_REGISTRY_MODULE) {
		const source = join(root, 'tests/fixtures/modelContext.ts')
		if (!existsSync(source)) return undefined
		const { transformWithOxc } = await import('vite')
		return (await transformWithOxc(readFileSync(source, 'utf8'), source)).code
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
 * Node: `@src/core` resolves to the core barrel's source, and a relative `.js` specifier that
 * resolves nothing falls back to its `.ts` source.
 *
 * @remarks
 * The script imports `registerHooks` from `node:module`, `pathToFileURL` from `node:url`, and
 * `resolve` from `node:path`, and runs from the workspace root, against which `resolve` reads.
 */
export const SOURCE_HOOK = `registerHooks({
	resolve(specifier, context, next) {
		if (specifier === '@src/core') return next(pathToFileURL(resolve('src/core/index.ts')).href, context)
		try { return next(specifier, context) }
		catch (error) {
			if (specifier.endsWith('.js') && (specifier.startsWith('.') || specifier.startsWith('file:')))
				return next(specifier.slice(0, -3) + '.ts', context)
			throw error
		}
	}
})`

// === Browse server fixtures

/**
 * Configures a {@link BrowserLauncher}.
 *
 * @remarks
 * - `failures` — how many launches, in order, reject at `connect()` with a `BrowserError`
 * - `evaluation` — answers each `Runtime.evaluate` the element fixture leaves unanswered, so a
 *   proof can withhold the text-wait evaluation
 * - `released` — answers each `mouseReleased` dispatch, so a proof can withhold a click's release
 * - `registry` — answers `WebMCP.enable`, so a page registry exists and its tools are adopted
 */
export interface BrowserLauncherOptions {
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
	readonly #options: BrowserOptions
	readonly #gate: Promise<void>
	readonly #failure: BrowserError | undefined
	readonly #handlers: BrowserLauncherOptions
	readonly #emitter = new Emitter<BrowserEventMap>()
	#fixture: BrowserElementFixture | undefined
	#connects = 0
	#destroyed = false

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
	}

	get emitter(): Emitter<BrowserEventMap> {
		return this.#emitter
	}

	get engine(): 'chromium' {
		return 'chromium'
	}

	get status(): BrowserStatus {
		return this.#fixture === undefined ? 'idle' : 'connected'
	}

	get connection(): BrowserConnection | undefined {
		return this.#fixture === undefined ? undefined : 'persistent'
	}

	get owned(): boolean | undefined {
		return this.#fixture === undefined ? undefined : true
	}

	get pid(): number | undefined {
		return undefined
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

	/** Holds the in-memory CDP fixture a connect opened. */
	get fixture(): BrowserElementFixture | undefined {
		return this.#fixture
	}

	async discover(): Promise<BrowserDiscoveryResult> {
		return { endpoint: undefined, browser: undefined }
	}

	async connect(): Promise<void> {
		this.#connects += 1
		await this.#gate
		if (this.#failure !== undefined) throw this.#failure
		const { evaluation, released, registry } = this.#handlers
		// The fixture scripts its transport before it returns it, so each answer reads the transport
		// off the fixture this connect stores.
		const fixture = await createBrowserElementFixture({
			...(evaluation === undefined
				? {}
				: { evaluation: (message) => this.#answer(evaluation, message) }),
			...(released === undefined ? {} : { released: (message) => this.#answer(released, message) }),
			...(registry === undefined ? {} : { registry: (message) => this.#answer(registry, message) }),
		})
		const { transport } = fixture
		transport.onSend('Target.createTarget', (message) =>
			transport.reply(message.id, { targetId: 'main' }),
		)
		transport.onSend('Target.attachToTarget', (message) =>
			transport.reply(message.id, { sessionId: 'session-main' }),
		)
		for (const method of [
			'Page.setInterceptFileChooserDialog',
			'Browser.setDownloadBehavior',
			'Network.enable',
			'Page.bringToFront',
		])
			replyOk(transport, method)
		this.#fixture = fixture
	}

	adopt(): void {}

	async disconnect(): Promise<void> {}

	context(): BrowserContextInterface | undefined {
		return undefined
	}

	contexts(): readonly BrowserContextInterface[] {
		return []
	}

	async isolate(): Promise<BrowserContextInterface> {
		const fixture = this.#fixture
		if (fixture === undefined) throw new BrowserError('The double is not connected')
		return new BrowserContext(fixture.client)
	}

	async create(): Promise<BrowserPageInterface> {
		const context = await this.isolate()
		return context.create()
	}

	async destroy(): Promise<void> {
		this.#destroyed = true
		await this.#fixture?.client.close()
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
				this.#failures > 0
					? new BrowserError('The fixture refused the launch', 'BROWSER_FIXTURE_LAUNCH')
					: undefined
			if (this.#failures > 0) this.#failures -= 1
			const browser = new BrowserLaunchDouble(options, this.#gate.promise, failure, this.#handlers)
			this.#browsers.push(browser)
			return browser
		}
	}

	/** Parks every later `connect()` until `release()`. */
	hold(): void {
		this.#gate = Promise.withResolvers<void>()
	}

	/** Lets every parked and later `connect()` continue. */
	release(): void {
		this.#gate.resolve()
	}
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
	'look',
	'read',
	'click',
	'type',
	'press',
	'navigate',
	'wait',
	'dialog',
	'tabs',
	'switch',
	'record',
	'save',
	'journeys',
	'edit',
	'replay',
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
 * Opens the protocol on a browse child and makes its first `look` call, which launches the
 * child's Chromium.
 *
 * @param child - The spawned child
 * @returns The text the `look` call answered
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
			params: { name: 'look', arguments: { what: 'the page' } },
		},
	)
	const answer = await retryUntil(
		'the answer to the first look',
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
		throw new Error(`the first look answered ${JSON.stringify(answer)}`)
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
 * - `browser` — the one launch its first `look` made
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
 * Starts a browse server under a scratch root and launches it with one `look`.
 *
 * @returns The started session
 * @throws Thrown when the `look` fails or the launch made no profile
 */
export async function openBrowseSession(): Promise<BrowseSession> {
	// The server entry loads on demand, as the store proofs load it, so the global setup that
	// imports this module never loads it.
	const { createBrowserMCPServer } = await import('../src/server/index.js')
	const scratch = createScratch()
	const launcher = new BrowserLauncher()
	const pair = new MCPStdioPair()
	const server = createBrowserMCPServer({
		root: join(scratch.path, 'tmp/browsers'),
		launch: launcher.launch,
		stdio: pair,
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
	const looked = await pair.call(2, 'look', { what: 'the cart' })
	if (looked.error) throw new Error(looked.text)
	const browser = requireValue(launcher.browsers[0], 'no launch was recorded')
	const profile = requireValue(browser.options.profile, 'the launch named no profile')
	if (!existsSync(profile)) throw new Error(`the launch made no profile at ${profile}`)
	return { pair, launcher, browser, profile, listeners, teardown }
}

// === Compiled journey modules

// Imports the built package through the staged link, so the browser context it returns and every
// page that context opens come from the same module instance a generated journey module imports.
const BROWSER_JOURNEY_HARNESS = `import { BrowserContext, createCDPClient } from '@orkestrel/browser'
import { createCDPTransport } from '@orkestrel/browser/server'

export async function connect(url) {
	const client = createCDPClient({ transport: createCDPTransport({ url }) })
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
		const compiler = createRequire(import.meta.url).resolve('typescript/bin/tsc')
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

function isBrowserContextValue(value: unknown): value is BrowserContextInterface {
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
