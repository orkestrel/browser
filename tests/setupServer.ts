import type { ChildProcess } from 'node:child_process'
import type { IncomingMessage, Server as HTTPServer, ServerResponse } from 'node:http'
import type { AddressInfo, Server as NetServer, Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import type { NodeWebSocketInterface } from '@orkestrel/websocket'
import type { ScratchInterface } from '@orkestrel/test/server'
import { createServer } from 'node:http'
import { createConnection, createServer as createNetServer } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import {
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
import { createLoopback, createScratch, isRunning } from '@orkestrel/test/server'
import {
	createTeardown,
	requireValue,
	retryUntil,
	waitForCondition,
	waitForEvent,
} from '@orkestrel/test'
import { describe, it, expect } from 'vitest'
import { BROWSER_RUN_FIXTURE, createBrowserJourneyFixture } from './setup.js'

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
 * Registers filesystem-only proofs for the durable journey and run stores.
 * @remarks Browser projects load the host-independent setup module, so these proofs stay server-side.
 */
export function describeFileBrowserStores(): void {
	describe('file store filesystem contracts', () => {
		it('allows exactly one competing process to save the same expected revision', async () => {
			const { spawn } = await import('node:child_process')
			const { FileBrowserJourneyStore } = await import('../src/server/index.js')
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
registerHooks({
	resolve(specifier, context, next) {
		try { return next(specifier, context) }
		catch (error) {
			if (specifier.endsWith('.js') && (specifier.startsWith('.') || specifier.startsWith('file:')))
				return next(specifier.slice(0, -3) + '.ts', context)
			throw error
		}
	}
})
const { FileBrowserJourneyStore } = await import(pathToFileURL(resolve('src/server/stores/FileBrowserJourneyStore.ts')).href)
const store = new FileBrowserJourneyStore({ root: process.argv[2] })
process.once('message', async (journey) => {
	try {
		const saved = await store.set(journey, 1)
		process.send?.({ outcome: 'saved', revision: saved.revision })
	} catch (error) {
		process.send?.({ outcome: 'refused', code: error.code })
	} finally { process.disconnect?.() }
})
process.send?.({ outcome: 'ready' })
`,
				)
				for (let index = 0; index < 2; index += 1)
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
				expect(ready.map((event) => event[0])).toEqual([{ outcome: 'ready' }, { outcome: 'ready' }])
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
				expect(results).toContainEqual({ outcome: 'saved', revision: 2 })
				expect(
					results.filter((value) => isRecord(value) && value['outcome'] === 'saved'),
				).toHaveLength(1)
				expect(
					results.filter(
						(value) =>
							isRecord(value) &&
							value['outcome'] === 'refused' &&
							['BROWSER_JOURNEY_LOCKED', 'BROWSER_JOURNEY_STALE'].includes(String(value['code'])),
					),
				).toHaveLength(1)
				expect(await Promise.all(exits)).toEqual([
					[0, null],
					[0, null],
				])
				expect((await store.get(journey.name))?.revision).toBe(2)
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
		}, 15000)

		it('reopens journeys and runs from the same path', async () => {
			const { FileBrowserJourneyStore, FileBrowserRunStore } =
				await import('../src/server/index.js')
			const scratch = createScratch()
			try {
				const options = { root: scratch.path }
				const journeys = new FileBrowserJourneyStore(options)
				const runs = new FileBrowserRunStore(options)
				const journey = createBrowserJourneyFixture()
				const saved = await journeys.set(journey)
				const slot = await runs.open(BROWSER_RUN_FIXTURE.journey.name)
				const run = { ...BROWSER_RUN_FIXTURE, id: slot.id }
				await runs.set(run)
				expect(await new FileBrowserJourneyStore(options).get(journey.name)).toEqual(saved)
				expect(await new FileBrowserRunStore(options).get(run.journey.name, run.id)).toEqual(run)
			} finally {
				scratch.destroy()
			}
		})

		it('refuses corrupt files rather than returning absence', async () => {
			const { writeFile } = await import('node:fs/promises')
			const { FileBrowserJourneyStore, FileBrowserRunStore } =
				await import('../src/server/index.js')
			const scratch = createScratch()
			try {
				const journeys = new FileBrowserJourneyStore({ root: scratch.path })
				const runs = new FileBrowserRunStore({ root: scratch.path })
				const saved = await journeys.set(createBrowserJourneyFixture())
				const slot = await runs.open(BROWSER_RUN_FIXTURE.journey.name)
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
					await expect(journeys.get(saved.journey.name)).rejects.toMatchObject({
						code: 'BROWSER_JOURNEY_FILE',
						message: expect.stringContaining(journeyPath),
					})
					await expect(runs.get(run.journey.name, run.id)).rejects.toMatchObject({
						code: 'BROWSER_JOURNEY_FILE',
						message: expect.stringContaining(runPath),
					})
				}
				await writeFile(
					journeyPath,
					JSON.stringify({ ...saved, journey: { ...saved.journey, format: 9 } }),
				)
				await writeFile(runPath, JSON.stringify({ ...run, format: 9 }))
				await expect(journeys.get(saved.journey.name)).rejects.toMatchObject({
					code: 'BROWSER_JOURNEY_FORMAT',
					message: expect.stringContaining(journeyPath),
				})
				await expect(runs.get(run.journey.name, run.id)).rejects.toMatchObject({
					code: 'BROWSER_JOURNEY_FORMAT',
					message: expect.stringContaining(runPath),
				})
			} finally {
				scratch.destroy()
			}
		})

		it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
			'reports chmod 000 permission errors (root bypasses mode bits)',
			async () => {
				const { chmod, copyFile, rename } = await import('node:fs/promises')
				const { FileBrowserJourneyStore, FileBrowserRunStore } =
					await import('../src/server/index.js')
				const scratch = createScratch()
				try {
					const journeys = new FileBrowserJourneyStore({ root: scratch.path })
					const runs = new FileBrowserRunStore({ root: scratch.path })
					const saved = await journeys.set(createBrowserJourneyFixture())
					const slot = await runs.open(BROWSER_RUN_FIXTURE.journey.name)
					await runs.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })
					const paths = [
						join(scratch.path, saved.journey.name, 'journey.json'),
						join(scratch.path, BROWSER_RUN_FIXTURE.journey.name, 'runs', slot.id, 'run.json'),
					]
					for (const path of paths) {
						await copyFile(path, path + '.copy')
						await chmod(path + '.copy', 0)
						await rename(path + '.copy', path)
					}
					try {
						await expect(journeys.get(saved.journey.name)).rejects.toMatchObject({
							code: 'BROWSER_JOURNEY_ACCESS',
						})
						await expect(runs.get(BROWSER_RUN_FIXTURE.journey.name, slot.id)).rejects.toMatchObject(
							{ code: 'BROWSER_JOURNEY_ACCESS' },
						)
					} finally {
						for (const path of paths) await chmod(path, 0o600)
					}
				} finally {
					scratch.destroy()
				}
			},
		)

		it('refuses a lost update across instances and preserves revisions after deletion', async () => {
			const { FileBrowserJourneyStore } = await import('../src/server/index.js')
			const scratch = createScratch()
			try {
				const first = new FileBrowserJourneyStore({ root: scratch.path })
				const second = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				await first.set(journey)
				const outcomes = await Promise.allSettled([
					first.set({ ...journey, description: 'First' }, 1),
					second.set({ ...journey, description: 'Second' }, 1),
				])
				expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
				expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
				expect((await first.get(journey.name))?.revision).toBe(2)
				await second.delete(journey.name)
				await expect(first.set(journey, 2)).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_STALE' })
				expect((await second.set(journey)).revision).toBe(3)
				await expect(first.set(journey, 2)).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_STALE' })
			} finally {
				scratch.destroy()
			}
		})

		it('refuses a held lock before reading the expected revision', async () => {
			const { writeFile, unlink } = await import('node:fs/promises')
			const { FileBrowserJourneyStore } = await import('../src/server/index.js')
			const scratch = createScratch()
			try {
				const store = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				await store.set(journey)
				const lock = join(scratch.path, journey.name, 'journey.lock')
				await writeFile(lock, '')
				await expect(store.set(journey, 0)).rejects.toMatchObject({
					code: 'BROWSER_JOURNEY_LOCKED',
				})
				await expect(store.delete(journey.name)).rejects.toMatchObject({
					code: 'BROWSER_JOURNEY_LOCKED',
				})
				await unlink(lock)
				expect((await store.set(journey, 1)).revision).toBe(2)
			} finally {
				scratch.destroy()
			}
		})

		it('keeps the previous revision and removes temporary files after a failed write', async () => {
			const { mkdir, unlink, readdir } = await import('node:fs/promises')
			const { FileBrowserJourneyStore } = await import('../src/server/index.js')
			const scratch = createScratch()
			try {
				const store = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				const saved = await store.set(journey)
				const revision = join(scratch.path, journey.name, 'revision')
				// A real directory at the counter path refuses the replacement before any data is lost.
				await unlink(revision)
				await mkdir(revision)
				await expect(
					store.set({ ...journey, description: 'Uncommitted' }, 1),
				).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_FILE' })
				expect(await store.get(journey.name)).toEqual(saved)
				expect((await readdir(join(scratch.path, journey.name))).sort()).toEqual([
					'journey.json',
					'revision',
				])
			} finally {
				scratch.destroy()
			}
		})

		it('pages sorted readable journeys with a cap, truncation, and faults', async () => {
			const { writeFile } = await import('node:fs/promises')
			const { FileBrowserJourneyStore } = await import('../src/server/index.js')
			const scratch = createScratch()
			try {
				const store = new FileBrowserJourneyStore({ root: scratch.path, limit: 1 })
				for (const name of ['zebra', 'broken', 'alpine', 'harbor'])
					await store.set(createBrowserJourneyFixture([], { name }))
				await writeFile(join(scratch.path, 'broken', 'journey.json'), '{')
				const first = await store.list({ limit: 999 })
				expect(first.entries.map((entry) => entry.journey.name)).toEqual(['alpine'])
				expect(first.truncated).toBe(true)
				expect(first.faults).toEqual([
					{ path: join(scratch.path, 'broken'), message: expect.stringContaining('journey.json') },
				])
				const next = await store.list({ offset: 1 })
				expect(next.entries.map((entry) => entry.journey.name)).toEqual(['harbor'])
				expect(next.truncated).toBe(true)
				expect((await store.list({ offset: 2 })).truncated).toBe(false)
			} finally {
				scratch.destroy()
			}
		})

		it('refuses reserved and escaping names before filesystem access', async () => {
			const { FileBrowserJourneyStore, FileBrowserRunStore } =
				await import('../src/server/index.js')
			const scratch = createScratch()
			const journeys = new FileBrowserJourneyStore({ root: scratch.path })
			const runs = new FileBrowserRunStore({ root: scratch.path })
			scratch.destroy()
			for (const name of ['con', 'aux', 'com1', 'lpt9', '../escape', 'two/parts', 'UPPER']) {
				await expect(journeys.get(name)).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_PATH' })
				await expect(journeys.set(createBrowserJourneyFixture([], { name }))).rejects.toMatchObject(
					{ code: 'BROWSER_JOURNEY_PATH' },
				)
				await expect(journeys.delete(name)).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_PATH' })
				await expect(runs.open(name)).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_PATH' })
			}
		})
	})
}
