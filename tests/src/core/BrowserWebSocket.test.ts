/**
 * src/core/BrowserWebSocket.ts tests.
 *
 * The class is a pure event projection over Network-domain frames, so every case drives
 * the real class and reads what its emitter published.
 */

import type { BrowserWebSocketFrame } from '@src/core'
import { describe, expect, it } from 'vitest'
import { BrowserWebSocket } from '@src/core'
import { createRecorder } from '@orkestrel/test'

const FRAME: BrowserWebSocketFrame = { opcode: 1, data: 'hello', masked: false, timestamp: 3 }

describe('BrowserWebSocket', () => {
	it('reports the identity it was constructed with', () => {
		const socket = new BrowserWebSocket('request-1', 'wss://example.com/live')

		expect([socket.id, socket.url]).toStrictEqual(['request-1', 'wss://example.com/live'])
	})

	it('publishes received and transmitted frames on their own events', () => {
		const socket = new BrowserWebSocket('request-1', 'wss://example.com/live')
		const received = createRecorder<[frame: BrowserWebSocketFrame]>()
		const transmitted = createRecorder<[frame: BrowserWebSocketFrame]>()
		socket.emitter.on('receive', received.handler)
		socket.emitter.on('transmit', transmitted.handler)

		socket.receive(FRAME)
		socket.transmit(FRAME)

		expect(received.calls).toStrictEqual([[FRAME]])
		expect(transmitted.calls).toStrictEqual([[FRAME]])
	})

	it('publishes a failure message on the error event', () => {
		const socket = new BrowserWebSocket('request-1', 'wss://example.com/live')
		const errors = createRecorder<[message: string]>()
		socket.emitter.on('error', errors.handler)

		socket.fail('handshake rejected')

		expect(errors.calls).toStrictEqual([['handshake rejected']])
	})

	it('closes once, carrying the timestamp, and destroys its emitter', () => {
		const socket = new BrowserWebSocket('request-1', 'wss://example.com/live')
		const closes = createRecorder<[timestamp: number]>()
		socket.emitter.on('close', closes.handler)

		socket.close(9)
		socket.close(10)

		expect(closes.calls).toStrictEqual([[9]])
		expect(socket.emitter.destroyed).toBe(true)
	})

	it('drops every frame delivered after the close', () => {
		const socket = new BrowserWebSocket('request-1', 'wss://example.com/live')
		const received = createRecorder<[frame: BrowserWebSocketFrame]>()
		const transmitted = createRecorder<[frame: BrowserWebSocketFrame]>()
		const errors = createRecorder<[message: string]>()
		socket.emitter.on('receive', received.handler)
		socket.emitter.on('transmit', transmitted.handler)
		socket.emitter.on('error', errors.handler)

		socket.close(1)
		socket.receive(FRAME)
		socket.transmit(FRAME)
		socket.fail('late')

		expect([received.count, transmitted.count, errors.count]).toStrictEqual([0, 0, 0])
	})
})
