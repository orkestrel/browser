import type { IncomingMessage, Server as HTTPServer } from 'node:http'
import type { Socket } from 'node:net'
import type { CDPTarget } from '@src/core'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// === Server-only test helpers (AGENTS §16.1 — node:* allowed here)

/** WebSocket handshake GUID (RFC 6455 §1.3). */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

// === Minimal RFC 6455 frame codec (server side, text frames only)

/**
 * Encode a UTF-8 text payload as a single unmasked server→client WebSocket frame.
 *
 * @param payload - The frame payload as a Buffer
 * @returns The encoded frame bytes
 */
function encodeFrame(payload: Buffer): Buffer {
	const length = payload.length
	let header: Buffer

	if (length < 126) {
		header = Buffer.from([0x81, length])
	} else if (length < 65536) {
		header = Buffer.alloc(4)
		header[0] = 0x81
		header[1] = 126
		header.writeUInt16BE(length, 2)
	} else {
		header = Buffer.alloc(10)
		header[0] = 0x81
		header[1] = 127
		header.writeBigUInt64BE(BigInt(length), 2)
	}

	return Buffer.concat([header, payload])
}

interface DecodedFrame {
	readonly opcode: number
	readonly payload: Buffer
	readonly rest: Buffer
}

/** WebSocket close frame opcode (RFC 6455 §5.5.1). */
const WS_OPCODE_CLOSE = 0x8

/** Encode an empty unmasked server→client WebSocket close frame. */
function encodeCloseFrame(): Buffer {
	return Buffer.from([0x88, 0x00])
}

/**
 * Decode the first complete masked client→server WebSocket text frame from
 * a buffer, if one is fully present.
 *
 * @param buffer - Accumulated bytes received from the socket so far
 * @returns The decoded payload and remaining buffer, or undefined when incomplete
 */
function decodeFrame(buffer: Buffer): DecodedFrame | undefined {
	if (buffer.length < 2) return undefined

	const first = buffer[0]
	const second = buffer[1]
	if (first === undefined || second === undefined) return undefined

	const opcode = first & 0x0f
	const masked = (second & 0x80) !== 0
	let length = second & 0x7f
	let offset = 2

	if (length === 126) {
		if (buffer.length < 4) return undefined
		length = buffer.readUInt16BE(2)
		offset = 4
	} else if (length === 127) {
		if (buffer.length < 10) return undefined
		length = Number(buffer.readBigUInt64BE(2))
		offset = 10
	}

	let mask: Buffer | undefined
	if (masked) {
		if (buffer.length < offset + 4) return undefined
		mask = buffer.subarray(offset, offset + 4)
		offset += 4
	}

	if (buffer.length < offset + length) return undefined

	const payload = Buffer.from(buffer.subarray(offset, offset + length))
	if (mask !== undefined) {
		for (let i = 0; i < payload.length; i++) {
			const maskByte = mask[i % 4] ?? 0
			payload[i] = (payload[i] ?? 0) ^ maskByte
		}
	}

	const rest = Buffer.from(buffer.subarray(offset + length))
	return { opcode, payload, rest }
}

function isRecord(value: unknown): value is Record<string, unknown> {
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
	let activeSocket: Socket | undefined
	const sockets = new Set<Socket>()
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
		if (activeSocket === undefined) return
		activeSocket.write(encodeFrame(Buffer.from(JSON.stringify(data), 'utf8')))
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

		const accept = createHash('sha1')
			.update(key + WS_GUID)
			.digest('base64')

		socket.write(
			'HTTP/1.1 101 Switching Protocols\r\n' +
				'Upgrade: websocket\r\n' +
				'Connection: Upgrade\r\n' +
				`Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
		)

		activeSocket = socket
		sockets.add(socket)
		let buffer: Buffer<ArrayBufferLike> = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0)

		socket.on('data', (chunk: Buffer) => {
			buffer = Buffer.concat([buffer, chunk])
			for (;;) {
				const decoded = decodeFrame(buffer)
				if (decoded === undefined) break
				buffer = decoded.rest

				if (decoded.opcode === WS_OPCODE_CLOSE) {
					socket.end(encodeCloseFrame())
					continue
				}

				handleMessage(decoded.payload.toString('utf8'))
			}
		})

		socket.on('close', () => {
			sockets.delete(socket)
			if (activeSocket === socket) activeSocket = undefined
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
			for (const socket of sockets) socket.destroy()
			sockets.clear()
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()))
			})
		},
	}
}

// === Fake browser process (real spawned executable, no mocks)

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
	const lines: string[] = [
		`require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid))`,
	]

	if (options.ignoreSigterm === true) {
		lines.push("process.on('SIGTERM', () => {})")
	}

	if (options.serveCdp === true) {
		lines.push(
			[
				"const http = require('http')",
				"const crypto = require('crypto')",
				"const portArg = process.argv.find((a) => a.startsWith('--remote-debugging-port='))",
				"const port = Number(portArg.split('=')[1])",
				"const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'",
				'let activeSocket = null',
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
				"server.on('upgrade', (req, socket) => {",
				"\tconst key = req.headers['sec-websocket-key']",
				"\tconst accept = crypto.createHash('sha1').update(key + GUID).digest('base64')",
				'\tsocket.write(',
				"\t\t'HTTP/1.1 101 Switching Protocols\\r\\n' +",
				"\t\t\t'Upgrade: websocket\\r\\n' +",
				"\t\t\t'Connection: Upgrade\\r\\n' +",
				'\t\t\t`Sec-WebSocket-Accept: ${accept}\\r\\n\\r\\n`,',
				'\t)',
				'\tactiveSocket = socket',
				'\tlet buffer = Buffer.alloc(0)',
				"\tsocket.on('data', (chunk) => {",
				'\t\tbuffer = Buffer.concat([buffer, chunk])',
				'\t\tfor (;;) {',
				'\t\t\tif (buffer.length < 2) break',
				'\t\t\tconst first = buffer[0]',
				'\t\t\tconst second = buffer[1]',
				'\t\t\tconst opcode = first & 0x0f',
				'\t\t\tif (opcode === 0x8) {',
				'\t\t\t\tsocket.end(Buffer.from([0x88, 0x00]))',
				'\t\t\t\tbuffer = buffer.subarray(2)',
				'\t\t\t\tcontinue',
				'\t\t\t}',
				'\t\t\tconst masked = (second & 0x80) !== 0',
				'\t\t\tlet length = second & 0x7f',
				'\t\t\tlet offset = 2',
				'\t\t\tif (length === 126) {',
				'\t\t\t\tif (buffer.length < 4) break',
				'\t\t\t\tlength = buffer.readUInt16BE(2)',
				'\t\t\t\toffset = 4',
				'\t\t\t} else if (length === 127) {',
				'\t\t\t\tif (buffer.length < 10) break',
				'\t\t\t\tlength = Number(buffer.readBigUInt64BE(2))',
				'\t\t\t\toffset = 10',
				'\t\t\t}',
				'\t\t\tlet mask',
				'\t\t\tif (masked) {',
				'\t\t\t\tif (buffer.length < offset + 4) break',
				'\t\t\t\tmask = buffer.subarray(offset, offset + 4)',
				'\t\t\t\toffset += 4',
				'\t\t\t}',
				'\t\t\tif (buffer.length < offset + length) break',
				'\t\t\tconst payload = Buffer.from(buffer.subarray(offset, offset + length))',
				'\t\t\tif (mask) {',
				'\t\t\t\tfor (let i = 0; i < payload.length; i++) payload[i] = payload[i] ^ mask[i % 4]',
				'\t\t\t}',
				'\t\t\tbuffer = buffer.subarray(offset + length)',
				'\t\t\ttry {',
				'\t\t\t\tconst msg = JSON.parse(payload.toString(\'utf8\'))',
				"\t\t\t\tif (msg.method === 'Browser.close') {",
				'\t\t\t\t\tconst body = Buffer.from(JSON.stringify({ id: msg.id, result: {} }), \'utf8\')',
				'\t\t\t\t\tconst len = body.length',
				'\t\t\t\t\tlet header',
				'\t\t\t\t\tif (len < 126) header = Buffer.from([0x81, len])',
				'\t\t\t\t\telse { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2) }',
				'\t\t\t\t\tsocket.write(Buffer.concat([header, body]))',
				'\t\t\t\t\tsetImmediate(() => process.exit(0))',
				'\t\t\t\t}',
				'\t\t\t} catch {}',
				'\t\t}',
				'\t})',
				"\tsocket.on('close', () => {",
				'\t\tif (activeSocket === socket) activeSocket = null',
				'\t})',
				'})',
				"server.listen(port, '127.0.0.1')",
				"process.on('SIGUSR2', () => {",
				'\tif (activeSocket) activeSocket.destroy()',
				'})',
			].join('\n'),
		)
	} else {
		lines.push('setInterval(() => {}, 1000)')
	}

	writeFileSync(scriptPath, `${lines.join('\n')}\n`)

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
