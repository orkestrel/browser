import type { IncomingMessage, Server as HTTPServer } from 'node:http'
import type { Socket } from 'node:net'
import type { CDPTarget } from '@src/core'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

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

	const server: HTTPServer = createServer((req, res) => {
		const url = req.url ?? ''
		if (url.startsWith('/json/version')) {
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
			const result =
				typeof scripted === 'function'
					? (scripted as CDPServerReplyHandler)(params ?? {})
					: scripted
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
		let buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0)

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
		async close(): Promise<void> {
			for (const socket of sockets) socket.destroy()
			sockets.clear()
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()))
			})
		},
	}
}
