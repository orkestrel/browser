import type { IncomingMessage, Server as HTTPServer, ServerResponse } from 'node:http'
import type { AddressInfo, Server as NetServer, Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import type { NodeWebSocketInterface } from '@orkestrel/websocket'
import { createServer } from 'node:http'
import { createConnection, createServer as createNetServer } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { isRecord, isString } from '@orkestrel/contract'
import { createNodeWebSocket } from '@orkestrel/websocket'
import { waitForCondition } from './setup.js'

/**
 * Reserve a free localhost port by binding an ephemeral server to port 0 and
 * immediately closing it — avoids hardcoded test ports colliding across
 * parallel/aborted runs.
 *
 * @returns A currently-free TCP port number
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

/** Read the bound TCP port or throw when the server has no address. */
export function readServerPort(server: NetServer): number {
	const address: AddressInfo | string | null = server.address()
	if (typeof address !== 'object' || address === null) {
		throw new Error('Test server did not bind a TCP port')
	}
	return address.port
}

// === Server-only test helpers (AGENTS §16.1 — node:* allowed here)

/**
 * Whether a process currently accepts signal `0`.
 *
 * @param pid - Process identifier to probe
 * @returns True while the process is alive
 */
export function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

/**
 * Wait until a process exits.
 *
 * @param pid - Process identifier to observe
 * @param timeout - Maximum wait in milliseconds
 * @returns A promise resolving after the process exits
 */
export function waitForProcessExit(pid: number, timeout = 5000): Promise<void> {
	return waitForCondition(() => !isProcessAlive(pid), timeout, 50)
}

const registeredTempDirectories: string[] = []

/** Create and register a temporary directory for deterministic test teardown. */
export function createTempDirectory(prefix = 'orkestrel-browser-test-'): string {
	const dir = mkdtempSync(join(tmpdir(), prefix))
	registeredTempDirectories.push(dir)
	return dir
}

/** Create and register a persistent-profile fixture directory. */
export function createBrowserProfile(): string {
	return createTempDirectory('orkestrel-browser-profile-')
}

/** Remove every registered test directory, retrying transient Windows locks. */
export function destroyTempDirectories(): void {
	for (const dir of registeredTempDirectories.splice(0)) {
		rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
	}
}

/** Raw TCP fixture that accepts connections without completing a handshake. */
export interface StallServerInterface {
	readonly endpoint: string
	close(): Promise<void>
}

/** Start a raw TCP server that leaves every accepted connection open. */
export async function createStallServer(): Promise<StallServerInterface> {
	const server = new StallServer()
	await server.start()
	return server
}

/** Stateful implementation of the stalling TCP fixture. */
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

/** Restartable raw TCP proxy fixture used to sever and restore a connection. */
export interface TCPProxyInterface {
	start(host: string, port: number): Promise<void>
	stop(): Promise<void>
}

/** Create a restartable TCP proxy bound to a fixed local port. */
export function createTCPProxy(port: number): TCPProxyInterface {
	return new TCPProxy(port)
}

/** Stateful implementation of the restartable TCP proxy fixture. */
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

/** A CDP JSON-RPC request frame received by the test server. */
export interface CDPServerReceived {
	readonly id: number
	readonly method: string
	readonly params: Readonly<Record<string, unknown>> | undefined
}

/** Handler that computes an auto-reply result for a scripted CDP method. */
export type CDPServerReplyHandler = (params: Readonly<Record<string, unknown>>) => unknown

/**
 * An in-process HTTP+WebSocket server speaking just enough raw CDP to drive
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
	/** Count of currently open WebSocket sockets (for close-propagation assertions). */
	readonly sockets: number
	/** Set the targets returned by `/json/list` (drives `fetchCDPTargets`/`syncContexts`). */
	list(targets: readonly unknown[]): void
	/** Script an automatic reply for every request matching `method`. */
	script(method: string, result: unknown | CDPServerReplyHandler): void
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
 * Start an in-process CDP test server on a free localhost port.
 *
 * @returns A {@link CDPTestServerInterface}
 */
export async function createCDPTestServer(): Promise<CDPTestServerInterface> {
	const server = new CDPTestServer()
	await server.start()
	return server
}

/** Real HTTP and WebSocket fixture implementing the test CDP surface. */
export class CDPTestServer implements CDPTestServerInterface {
	readonly #server: HTTPServer
	readonly #received: CDPServerReceived[] = []
	readonly #scripts = new Map<string, unknown | CDPServerReplyHandler>()
	readonly #sockets = new Set<NodeWebSocketInterface>()
	#targets: readonly unknown[] = []
	#active: NodeWebSocketInterface | undefined
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
		return `http://localhost:${this.port}`
	}

	get endpoint(): string {
		return `ws://localhost:${this.port}/cdp`
	}

	get received(): readonly CDPServerReceived[] {
		return this.#received
	}

	get sockets(): number {
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

	list(targets: readonly unknown[]): void {
		this.#targets = targets
	}

	script(method: string, result: unknown | CDPServerReplyHandler): void {
		this.#scripts.set(method, result)
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
		if (typeof key !== 'string') {
			socket.destroy()
			return
		}

		const webSocket = createNodeWebSocket({ socket, key, head })
		this.#active = webSocket
		this.#sockets.add(webSocket)
		webSocket.emitter.on('message', (text) => this.#message(text))
		webSocket.emitter.on('close', () => {
			this.#sockets.delete(webSocket)
			if (this.#active === webSocket) this.#active = undefined
		})
	}

	#message(text: string): void {
		let parsed: unknown
		try {
			parsed = JSON.parse(text)
		} catch {
			return
		}
		if (
			!isRecord(parsed) ||
			typeof parsed['id'] !== 'number' ||
			typeof parsed['method'] !== 'string'
		) {
			return
		}

		const id = parsed['id']
		const method = parsed['method']
		const params = isRecord(parsed['params']) ? parsed['params'] : undefined
		this.#received.push({ id, method, params })

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
				method === 'Browser.setDownloadBehavior') &&
			!this.#scripts.has(method)
		) {
			this.#send({ id, result: {} })
			return
		}

		if (!this.#scripts.has(method)) return
		const scripted = this.#scripts.get(method)
		const result = typeof scripted === 'function' ? scripted(params ?? {}) : scripted
		this.#send({ id, result })
	}

	#send(data: Record<string, unknown>): void {
		this.#active?.send(JSON.stringify(data))
	}
}

// === Fake browser process (real spawned executable, no mocks)

/** A registered fake-browser fixture, tracked for guaranteed teardown. */
interface RegisteredFakeBrowser {
	readonly pidFiles: readonly string[]
	readonly dir: string
}

const registeredFakeBrowsers: RegisteredFakeBrowser[] = []

/**
 * Guaranteed teardown safety net for every fake browser process created via
 * `createFakeBrowserProcess` — SIGKILLs any still-alive registered pid
 * (tolerating a not-yet-written pid file or an already-dead process) and
 * clears the registry. Wire into a top-level `afterEach` alongside each
 * test's own explicit kills.
 */
export async function destroyFakeBrowsers(): Promise<void> {
	for (const fixture of registeredFakeBrowsers.splice(0)) {
		for (const pidFile of fixture.pidFiles) {
			let pid: number | undefined
			try {
				const contents = readFileSync(pidFile, 'utf8').trim()
				if (contents.length > 0) pid = Number(contents)
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
		rmSync(fixture.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
	}
}

/**
 * Read a fixture process identifier once its spawned script has published it.
 *
 * @param path - PID file written by the fixture process
 * @returns The published process identifier
 */
export async function readFixtureProcessId(path: string): Promise<number> {
	for (let attempt = 0; attempt < 50; attempt++) {
		try {
			const contents = readFileSync(path, 'utf8').trim()
			if (contents.length > 0) return Number(contents)
		} catch {
			// Not written yet
		}
		await new Promise((resolve) => setTimeout(resolve, 20))
	}
	throw new Error(`Fake browser process never wrote its pid to ${path}`)
}

/** A real, spawned stand-in "browser" process for exercising Browser's launch path. */
export interface FakeBrowserProcessInterface {
	/** The Node executable path (used as `BrowserOptions.executable`) — spawnable identically on every platform. */
	readonly executable: string
	/** Launch args (used as `BrowserOptions.args`) — must precede any CDP flags `launchBrowserProcess` appends. */
	readonly args: readonly string[]
	/** Reads the PID the process wrote at startup (polls briefly if not yet written). */
	pid(): Promise<number>
	/** Reads the PID of the process-tree fixture requested through `descendant`. */
	descendant(): Promise<number>
	/** Reads the complete process argument vector recorded at startup. */
	arguments(): Promise<readonly string[]>
	/**
	 * Sever the active CDP WebSocket socket (via an HTTP control request to the
	 * fake's own server) while leaving the process itself alive — simulates a
	 * transport-loss without a process exit. Only meaningful when constructed
	 * with `serveCDP: true`.
	 */
	dropSocket(): Promise<void>
}

/**
 * Write a small, real Node script that stands in for a browser executable in
 * `Browser`'s launch path — no mocking of `child_process`. The script is
 * spawned as `node <script> <cdp-flags...>` (via `executable`/`args`) rather
 * than executed directly, so it is spawnable identically on Windows/macOS/Linux
 * (a directly-spawned shebang script is not portable to Windows).
 *
 * @param options - `serveCDP` runs a minimal real HTTP+WebSocket CDP endpoint
 * (parses `--remote-debugging-port=` from its own argv); `ignoreSIGTERM`
 * traps SIGTERM in the parent and requested descendant so only SIGKILL can
 * terminate them; `descendant` spawns that process-tree fixture. With none
 * of these options the process just idles (never serves CDP) — useful for
 * launch-failure/abort scenarios.
 * @returns A {@link FakeBrowserProcessInterface}
 */
export function createFakeBrowserProcess(
	options: {
		readonly serveCDP?: boolean
		readonly ignoreSIGTERM?: boolean
		readonly descendant?: boolean
	} = {},
): FakeBrowserProcessInterface {
	const dir = mkdtempSync(join(tmpdir(), 'orkestrel-browser-fake-'))
	const scriptPath = join(dir, 'fake-browser.js')
	const pidFile = join(dir, 'pid.txt')
	const descendantFile = join(dir, 'descendant.txt')
	const argumentsFile = join(dir, 'arguments.json')
	const portFile = join(dir, 'port.txt')

	// No shebang: the script is spawned via `node <script>`, never executed
	// directly, so it needs no execute bit and no shebang line.
	const crashLogPath = join(dir, 'crash.log')
	const lines: string[] = [
		`process.on('uncaughtException', (e) => { try { require('fs').appendFileSync(${JSON.stringify(crashLogPath)}, String(e && e.stack)) } catch {} ; process.exit(1) })`,
		`require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
		`require('fs').writeFileSync(${JSON.stringify(argumentsFile)}, JSON.stringify(process.argv))`,
	]

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
	// parent is gone even where reparenting never yields ppid 1.
	lines.push(
		[
			'const __ppid = process.ppid',
			'setInterval(() => {',
			'\tif (process.ppid === 1) { process.exit(0); return }',
			'\ttry { process.kill(__ppid, 0) } catch { process.exit(0) }',
			'}, 500)',
		].join('\n'),
	)

	if (options.serveCDP === true) {
		// The @orkestrel/websocket package is required by its real installed
		// .cjs entry point (resolved via `createRequire` at script-GENERATION
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
				"\t\t\t} else if (msg.method === 'Target.getTargets') {",
				'\t\t\t\tws.send(JSON.stringify({ id: msg.id, result: { targetInfos: [] } }))',
				'\t\t\t}',
				'\t\t} catch {}',
				'\t})',
				"\tws.emitter.on('close', () => {",
				'\t\tif (activeWS === ws) activeWS = undefined',
				'\t})',
				'})',
				"server.on('error', (e) => { console.error('fake-browser listen error: ' + e.message); process.exit(12) })",
				"server.listen(port, '127.0.0.1', () => { require('fs').writeFileSync(" +
					JSON.stringify(portFile) +
					', String(port)) })',
			].join('\n'),
		)
	}

	writeFileSync(scriptPath, `${lines.join('\n')}\n`)

	registeredFakeBrowsers.push({ pidFiles: [pidFile, descendantFile], dir })

	return {
		executable: process.execPath,
		args: [scriptPath],
		async pid(): Promise<number> {
			return readFixtureProcessId(pidFile)
		},
		async descendant(): Promise<number> {
			return readFixtureProcessId(descendantFile)
		},
		async arguments(): Promise<readonly string[]> {
			for (let attempt = 0; attempt < 50; attempt++) {
				try {
					const parsed: unknown = JSON.parse(readFileSync(argumentsFile, 'utf8'))
					if (Array.isArray(parsed) && parsed.every(isString)) return parsed
				} catch {
					// Not written yet
				}
				await new Promise((resolve) => setTimeout(resolve, 20))
			}
			throw new Error(`Fake browser process never wrote its arguments to ${argumentsFile}`)
		},
		async dropSocket(): Promise<void> {
			let dropPort: number | undefined
			for (let attempt = 0; attempt < 50; attempt++) {
				try {
					const contents = readFileSync(portFile, 'utf8').trim()
					if (contents.length > 0) {
						dropPort = Number(contents)
						break
					}
				} catch {
					// Not written yet
				}
				await new Promise((resolve) => setTimeout(resolve, 20))
			}
			if (dropPort === undefined) {
				throw new Error(`Fake browser process never wrote its listening port to ${portFile}`)
			}
			await fetch(`http://127.0.0.1:${dropPort}/__drop`)
		},
	}
}
