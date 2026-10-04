// Usage: node tests/fixtures/hung/main.ts TRANSCRIPT [Chromium launch flags].
// Serves the launch protocol, then withholds replies after the validation ping. Exit: killed by owner.
import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { isNumber, isRecord, isString, parseJSON } from '@orkestrel/contract'
import { createNodeWebSocket } from '@orkestrel/websocket'

const transcript = process.argv[2]
if (transcript === undefined) throw new Error('Missing transcript path')
let validated = false
const server = createServer((_request, response) => {
	response.writeHead(404)
	response.end()
})
server.on('upgrade', (request, socket, head) => {
	const key = request.headers['sec-websocket-key']
	if (typeof key !== 'string') throw new Error('Missing WebSocket key')
	const peer = createNodeWebSocket({ socket, key, head })
	peer.emitter.on('message', (text) => {
		const message = parseJSON(text)
		if (!isRecord(message) || !isNumber(message['id']) || !isString(message['method']))
			throw new Error('Invalid CDP request')
		const method = message['method']
		appendFileSync(transcript, `${method}\n`)
		if (validated) return
		const envelope = { id: message['id'], sessionId: message['sessionId'] }
		let result: Readonly<Record<string, unknown>> = {}
		switch (method) {
			case 'SystemInfo.getProcessInfo':
				result = { processInfo: [{ type: 'browser', id: process.pid, cpuTime: 0 }] }
				break
			case 'Target.getTargets':
				result = { targetInfos: [] }
				break
			case 'Target.createBrowserContext':
				result = { browserContextId: 'isolated' }
				break
			case 'Target.createTarget':
				result = { targetId: 'page' }
				break
			case 'Target.attachToTarget':
				result = { sessionId: 'session-page' }
				break
			case 'Page.getFrameTree':
				result = { frameTree: { frame: { id: 'frame', url: 'about:blank' } } }
				break
			case 'Browser.getVersion':
				result = { product: 'Boundary/1.0', protocolVersion: '1.3' }
				validated = true
				break
			case 'WebMCP.enable':
				peer.send(JSON.stringify({ ...envelope, error: { code: -32601, message: 'Unavailable' } }))
				return
		}
		peer.send(JSON.stringify({ ...envelope, result }))
	})
})
server.listen(0, '127.0.0.1', () => {
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('Missing bound port')
	process.stderr.write(
		`DevTools listening on ws://127.0.0.1:${address.port}/devtools/browser/held\n`,
	)
})
