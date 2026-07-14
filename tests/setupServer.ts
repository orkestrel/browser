import type { IncomingMessage, Server as HTTPServer } from 'node:http'
import type { Socket } from 'node:net'
import type { CDPTarget } from '@src/core'
import type { NodeWebSocketInterface } from '@orkestrel/websocket'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNodeWebSocket } from '@orkestrel/websocket'

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
		probe.listen(0, '127.0.0.1', () => {
			const address = probe.address()
			resolve(isRecord(address) && typeof address['port'] === 'number' ? address['port'] : 0)
		})
	})
	await new Promise<void>((resolve) => probe.close(() => resolve()))
	return port
}

// === Server-only test helpers (AGENTS §16.1 — node:* allowed here)

/** Type guard for a plain (non-array, non-null) object — shared across server-only test helpers/fixtures. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
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
	readonly wsUrl: string
	readonly received: readonly CDPServerReceived[]
	/** Count of currently open WebSocket sockets (for close-propagation assertions). */
	readonly sockets: number
	/** Set the targets returned by `/json/list` (drives `fetchCdpTargets`/`syncContexts`). */
	list(targets: readonly CDPTarget[]): void
	/** Script an automatic reply for every request matching `method`. */
	autoReply(method: string, result: unknown | CDPServerReplyHandler): void
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
export async function createCdpTestServer(): Promise<CDPTestServerInterface> {
	const received: CDPServerReceived[] = []
	const autoReplies = new Map<string, unknown | CDPServerReplyHandler>()
	let targets: readonly CDPTarget[] = []
	let activeWs: NodeWebSocketInterface | undefined
	const sockets = new Set<NodeWebSocketInterface>()
	let hangVersion = false

	const server: HTTPServer = createServer((req, res) => {
		const url = req.url ?? ''
		if (url.startsWith('/json/version')) {
			if (hangVersion) return
			res.writeHead(200, { 'content-type': 'application/json' })
			res.end(JSON.stringify({ webSocketDebuggerUrl: wsUrlFor(), Browser: 'Test/1.0' }))
			return
		}
		if (url.startsWith('/json/list')) {
			res.writeHead(200, { 'content-type': 'application/json' })
			res.end(JSON.stringify(targets))
			return
		}
		res.writeHead(404)
		res.end()
	})

	function wsUrlFor(): string {
		return `ws://localhost:${port}/cdp`
	}

	function sendFrame(data: Record<string, unknown>): void {
		if (activeWs === undefined) return
		activeWs.send(JSON.stringify(data))
	}

	function handleMessage(text: string): void {
		let parsed: unknown
		try {
			parsed = JSON.parse(text)
		} catch {
			return
		}
		if (!isRecord(parsed)) return

		const id = typeof parsed['id'] === 'number' ? parsed['id'] : -1
		const method = typeof parsed['method'] === 'string' ? parsed['method'] : ''
		const params = isRecord(parsed['params']) ? parsed['params'] : undefined
		received.push({ id, method, params })

		if (autoReplies.has(method)) {
			const scripted = autoReplies.get(method)
			const result = typeof scripted === 'function' ? scripted(params ?? {}) : scripted
			sendFrame({ id, result })
		}
	}

	server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
		const key = req.headers['sec-websocket-key']
		if (typeof key !== 'string') {
			socket.destroy()
			return
		}

		const ws = createNodeWebSocket({ socket, key, head })
		activeWs = ws
		sockets.add(ws)

		ws.emitter.on('message', (text) => handleMessage(text))

		ws.emitter.on('close', () => {
			sockets.delete(ws)
			if (activeWs === ws) activeWs = undefined
		})
	})

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	const port = isRecord(address) && typeof address['port'] === 'number' ? address['port'] : 0

	return {
		get port(): number {
			return port
		},
		get url(): string {
			return `http://localhost:${port}`
		},
		get wsUrl(): string {
			return wsUrlFor()
		},
		get received(): readonly CDPServerReceived[] {
			return received
		},
		get sockets(): number {
			return sockets.size
		},
		list(next: readonly CDPTarget[]): void {
			targets = next
		},
		autoReply(method: string, result: unknown | CDPServerReplyHandler): void {
			autoReplies.set(method, result)
		},
		reply(id: number, result: unknown): void {
			sendFrame({ id, result })
		},
		fail(id: number, message: string): void {
			sendFrame({ id, error: { message } })
		},
		event(method: string, params?: Readonly<Record<string, unknown>>, sessionId?: string): void {
			const frame: Record<string, unknown> = { method, params: params ?? {} }
			if (sessionId !== undefined) frame['sessionId'] = sessionId
			sendFrame(frame)
		},
		hang(enabled: boolean): void {
			hangVersion = enabled
		},
		async close(): Promise<void> {
			for (const ws of sockets) ws.destroy()
			sockets.clear()
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()))
			})
		},
	}
}

// === Fake browser process (real spawned executable, no mocks)

/** A registered fake-browser fixture, tracked for guaranteed teardown. */
interface RegisteredFakeBrowser {
	readonly pidFile: string
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
		let pid: number | undefined
		try {
			const contents = readFileSync(fixture.pidFile, 'utf8').trim()
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
	}
}

/** A real, spawned stand-in "browser" process for exercising Browser's launch path. */
export interface FakeBrowserProcessInterface {
	/** The Node executable path (used as `BrowserOptions.executable`) — spawnable identically on every platform. */
	readonly executable: string
	/** Launch args (used as `BrowserOptions.args`) — must precede any CDP flags `launchBrowserProcess` appends. */
	readonly args: readonly string[]
	/** Reads the PID the process wrote at startup (polls briefly if not yet written). */
	pid(): Promise<number>
	/**
	 * Sever the active CDP WebSocket socket (via `SIGUSR2`) while leaving the
	 * process itself alive — simulates a transport-loss without a process exit.
	 * Only meaningful when constructed with `serveCdp: true`.
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
 * @param options - `serveCdp` runs a minimal real HTTP+WebSocket CDP endpoint
 * (parses `--remote-debugging-port=` from its own argv); `ignoreSigterm`
 * traps SIGTERM so only SIGKILL can terminate it. With neither option the
 * process just idles (never serves CDP) — useful for launch-failure/abort
 * scenarios.
 * @returns A {@link FakeBrowserProcessInterface}
 */
export function createFakeBrowserProcess(
	options: { readonly serveCdp?: boolean; readonly ignoreSigterm?: boolean } = {},
): FakeBrowserProcessInterface {
	const dir = mkdtempSync(join(tmpdir(), 'orkestrel-browser-fake-'))
	const scriptPath = join(dir, 'fake-browser.js')
	const pidFile = join(dir, 'pid.txt')

	// No shebang: the script is spawned via `node <script>`, never executed
	// directly, so it needs no execute bit and no shebang line.
	const crashLogPath = join(dir, 'crash.log')
	const lines: string[] = [
		`process.on('uncaughtException', (e) => { try { require('fs').appendFileSync(${JSON.stringify(crashLogPath)}, String(e && e.stack)) } catch {} ; process.exit(1) })`,
		`require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
	]

	if (options.ignoreSigterm === true) {
		lines.push("process.on('SIGTERM', () => {})")
	}

	// Orphan watchdog: if the parent (test runner) is hard-aborted, this
	// process is reparented to init (ppid 1) — self-exit instead of leaking
	// across subsequent test runs.
	lines.push('setInterval(() => { if (process.ppid === 1) process.exit(0) }, 500)')

	if (options.serveCdp === true) {
		// The @orkestrel/websocket package is required by its absolute .cjs entry
		// point: this script runs from a temp dir with no node_modules of its own,
		// and it is spawned as plain CJS (matching the rest of this emitted
		// script), so an ESM `import` cannot be used here.
		const websocketEntry = '/home/user/browser/node_modules/@orkestrel/websocket/dist/src/server/index.cjs'
		lines.push(
			[
				"const http = require('http')",
				`const { createNodeWebSocket } = require(${JSON.stringify(websocketEntry)})`,
				"const portArg = process.argv.find((a) => a.startsWith('--remote-debugging-port='))",
				"const port = Number(portArg.split('=')[1])",
				'let activeWs = null',
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
				'\tres.writeHead(404)',
				'\tres.end()',
				'})',
				"server.on('upgrade', (req, socket, head) => {",
				"\tconst key = req.headers['sec-websocket-key']",
				'\tconst ws = createNodeWebSocket({ socket, key, head })',
				'\tactiveWs = ws',
				"\tws.emitter.on('message', (text) => {",
				'\t\ttry {',
				'\t\t\tconst msg = JSON.parse(text)',
				"\t\t\tif (msg.method === 'Browser.close') {",
				'\t\t\t\tws.send(JSON.stringify({ id: msg.id, result: {} }))',
				'\t\t\t\tsetImmediate(() => process.exit(0))',
				'\t\t\t}',
				'\t\t} catch {}',
				'\t})',
				"\tws.emitter.on('close', () => {",
				'\t\tif (activeWs === ws) activeWs = null',
				'\t})',
				'})',
				"server.on('error', (e) => { console.error('fake-browser listen error: ' + e.message); process.exit(12) })",
				"server.listen(port, '127.0.0.1')",
				"process.on('SIGUSR2', () => {",
				'\tif (activeWs) activeWs.destroy()',
				'})',
			].join('\n'),
		)
	}

	writeFileSync(scriptPath, `${lines.join('\n')}\n`)

	registeredFakeBrowsers.push({ pidFile, dir })

	return {
		executable: process.execPath,
		args: [scriptPath],
		async pid(): Promise<number> {
			for (let attempt = 0; attempt < 50; attempt++) {
				try {
					const contents = readFileSync(pidFile, 'utf8').trim()
					if (contents.length > 0) return Number(contents)
				} catch {
					// Not written yet
				}
				await new Promise((resolve) => setTimeout(resolve, 20))
			}
			throw new Error(`Fake browser process never wrote its pid to ${pidFile}`)
		},
		async dropSocket(): Promise<void> {
			const target = await this.pid()
			process.kill(target, 'SIGUSR2')
		},
	}
}
