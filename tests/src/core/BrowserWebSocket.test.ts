import { BrowserWebSocket } from '../../../src/core/BrowserWebSocket.js'
/**
 * src/core/BrowserWebSocket.ts tests.
 *
 * The class is a pure event projection over Network-domain frames, so every case drives
 * the real class and reads what its emitter published.
 */

import type { BrowserWebSocketFrame } from '@src/core'
import { describe, expect, it } from 'vitest'

import { createRecorder, requireValue } from '@orkestrel/test'

const FRAME: BrowserWebSocketFrame = { opcode: 1, data: 'hello', masked: false, timestamp: 3 }

describe('BrowserWebSocket', () => {
	it('reports the identity it was constructed with', () => {
		const drivers = createRecorder<Parameters<ConstructorParameters<typeof BrowserWebSocket>[2]>>()
		const socket = new BrowserWebSocket('request-1', 'wss://example.com/live', drivers.handler)

		for (const name of ['receive', 'transmit', 'fail', 'close']) expect(name in socket).toBe(false)
		expect([socket.id, socket.url]).toStrictEqual(['request-1', 'wss://example.com/live'])
	})

	it('publishes received and transmitted frames on their own events', () => {
		const drivers = createRecorder<Parameters<ConstructorParameters<typeof BrowserWebSocket>[2]>>()
		const socket = new BrowserWebSocket('request-1', 'wss://example.com/live', drivers.handler)
		const received = createRecorder<[frame: BrowserWebSocketFrame]>()
		const transmitted = createRecorder<[frame: BrowserWebSocketFrame]>()
		socket.emitter.on('receive', received.handler)
		socket.emitter.on('transmit', transmitted.handler)

		requireValue(drivers.calls[0]?.[0]).receive(FRAME)
		requireValue(drivers.calls[0]?.[0]).transmit(FRAME)

		expect(received.calls).toStrictEqual([[FRAME]])
		expect(transmitted.calls).toStrictEqual([[FRAME]])
	})

	it('publishes a failure message on the error event', () => {
		const drivers = createRecorder<Parameters<ConstructorParameters<typeof BrowserWebSocket>[2]>>()
		const socket = new BrowserWebSocket('request-1', 'wss://example.com/live', drivers.handler)
		const errors = createRecorder<[message: string]>()
		socket.emitter.on('error', errors.handler)

		requireValue(drivers.calls[0]?.[0]).fail('handshake rejected')

		expect(errors.calls).toStrictEqual([['handshake rejected']])
	})

	it('closes once, carrying the timestamp, and destroys its emitter', () => {
		const drivers = createRecorder<Parameters<ConstructorParameters<typeof BrowserWebSocket>[2]>>()
		const socket = new BrowserWebSocket('request-1', 'wss://example.com/live', drivers.handler)
		const closes = createRecorder<[timestamp: number]>()
		socket.emitter.on('close', closes.handler)

		requireValue(drivers.calls[0]?.[0]).close(9)
		requireValue(drivers.calls[0]?.[0]).close(10)

		expect(closes.calls).toStrictEqual([[9]])
		expect(socket.emitter.destroyed).toBe(true)
	})

	it('drops every frame delivered after the close', () => {
		const drivers = createRecorder<Parameters<ConstructorParameters<typeof BrowserWebSocket>[2]>>()
		const socket = new BrowserWebSocket('request-1', 'wss://example.com/live', drivers.handler)
		const received = createRecorder<[frame: BrowserWebSocketFrame]>()
		const transmitted = createRecorder<[frame: BrowserWebSocketFrame]>()
		const errors = createRecorder<[message: string]>()
		socket.emitter.on('receive', received.handler)
		socket.emitter.on('transmit', transmitted.handler)
		socket.emitter.on('error', errors.handler)

		requireValue(drivers.calls[0]?.[0]).close(1)
		requireValue(drivers.calls[0]?.[0]).receive(FRAME)
		requireValue(drivers.calls[0]?.[0]).transmit(FRAME)
		requireValue(drivers.calls[0]?.[0]).fail('late')

		expect([received.count, transmitted.count, errors.count]).toStrictEqual([0, 0, 0])
	})
})
