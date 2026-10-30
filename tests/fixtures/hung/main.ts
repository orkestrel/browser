// Usage: node tests/fixtures/hung/main.ts TRANSCRIPT [Chromium launch flags].
// Serves the launch protocol, then withholds replies after the validation ping. Exit: killed by owner.
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Buffer } from 'node:buffer'
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { isNumber, isRecord, isString, parseJSON } from '@orkestrel/contract'
import { createNodeWebSocket } from '@orkestrel/websocket'

class HungBrowserFixture {
	readonly #transcript: string
	readonly #server = createServer((_request, response) => {
		response.writeHead(404)
		response.end()
	})
	#validated = false

	constructor(transcript: string) {
		this.#transcript = transcript
		this.#server.on('upgrade', this.#upgrade.bind(this))
	}

	start(): void {
		this.#server.listen(0, '127.0.0.1', this.#listen.bind(this))
	}

	#listen(): void {
		const address = this.#server.address()
		if (address === null || typeof address === 'string') throw new Error('Missing bound port')
		process.stderr.write(
			`DevTools listening on ws://127.0.0.1:${address.port}/devtools/browser/held\n`,
		)
	}

	#upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
		const key = request.headers['sec-websocket-key']
		if (typeof key !== 'string') throw new Error('Missing WebSocket key')
		const peer = createNodeWebSocket({ socket, key, head })
		peer.emitter.on('message', this.#message.bind(this, peer))
	}

	#message(peer: ReturnType<typeof createNodeWebSocket>, text: string): void {
		const message = parseJSON(text)
		if (!isRecord(message) || !isNumber(message['id']) || !isString(message['method']))
			throw new Error('Invalid CDP request')
		const method = message['method']
		appendFileSync(this.#transcript, `${method}\n`)
		if (this.#validated) return
		const envelope = { id: message['id'], sessionId: message['sessionId'] }
		if (method === 'WebMCP.enable') {
			peer.send(JSON.stringify({ ...envelope, error: { code: -32601, message: 'Unavailable' } }))
			return
		}
		const result = this.#result(method)
		peer.send(JSON.stringify({ ...envelope, result }))
	}

	#result(method: string): Readonly<Record<string, unknown>> {
		switch (method) {
			case 'SystemInfo.getProcessInfo':
				return { processInfo: [{ type: 'browser', id: process.pid, cpuTime: 0 }] }
			case 'Target.getTargets':
				return { targetInfos: [] }
			case 'Target.createBrowserContext':
				return { browserContextId: 'isolated' }
			case 'Target.createTarget':
				return { targetId: 'page' }
			case 'Target.attachToTarget':
				return { sessionId: 'session-page' }
			case 'Page.getFrameTree':
				return { frameTree: { frame: { id: 'frame', url: 'about:blank' } } }
			case 'Browser.getVersion':
				this.#validated = true
				return { product: 'Boundary/1.0', protocolVersion: '1.3' }
			default:
				return {}
		}
	}
}

const transcript = process.argv[2]
if (transcript === undefined) throw new Error('Missing transcript path')
new HungBrowserFixture(transcript).start()
