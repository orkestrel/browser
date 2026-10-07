import { describe, expect, inject, it } from 'vitest'
import { isString } from '@orkestrel/contract'
import { createRecorder, waitForEvent } from '@orkestrel/test'
import { createCDPClient, isBrowserError } from '@src/core'
import { createSocketCDPTransport, SocketCDPTransport } from '@src/browser'

describe('SocketCDPTransport', () => {
	it('carries a CDP client to Browser.getVersion over the page WebSocket', async () => {
		const client = createCDPClient({
			transport: new SocketCDPTransport({ url: inject('endpoint') }),
		})
		await client.connect()
		try {
			const version = await client.send('Browser.getVersion')
			const product: unknown = Reflect.get(Object(version), 'product')
			expect(product).toBe(inject('product'))
			expect(isString(product) && product).toMatch(/^[^\s/]+\/\d+(?:\.\d+)+$/)
			expect(version).toMatchObject({
				protocolVersion: expect.stringMatching(/^\d+\.\d+$/),
				revision: expect.stringMatching(/^\S+$/),
				jsVersion: expect.stringMatching(/^\d+(?:\.\d+)+/),
				userAgent: expect.stringContaining('Mozilla/'),
			})
		} finally {
			await client.close()
		}
	})

	it('emits close on a remote close, and the client reports drop', async () => {
		const browser = createCDPClient({
			transport: createSocketCDPTransport({ url: inject('endpoint') }),
		})
		await browser.connect()
		try {
			const created = await browser.send('Target.createTarget', { url: 'about:blank' })
			const target: unknown = Reflect.get(Object(created), 'targetId')
			if (!isString(target)) throw new Error('Target.createTarget returned no targetId')
			const page = new URL(inject('endpoint'))
			page.pathname = `/devtools/page/${target}`
			const transport = new SocketCDPTransport({ url: page.href })
			const closes = createRecorder<[]>()
			transport.emitter.on('close', closes.handler)
			const client = createCDPClient({ transport })
			const drops = createRecorder<[]>()
			client.emitter.on('drop', drops.handler)
			await client.connect()
			const dropped = waitForEvent<[]>((listener) => {
				client.emitter.on('drop', listener)
				return () => client.emitter.off('drop', listener)
			}, 'client drop')
			await browser.send('Target.closeTarget', { targetId: target })
			await dropped
			expect(closes.count).toBe(1)
			expect(drops.count).toBe(1)
			const refusal = await transport.send('{}').catch((error: unknown) => error)
			expect(isBrowserError(refusal) && refusal.code === 'CONNECTION').toBe(true)
		} finally {
			await browser.close()
		}
	})

	it('refuses send before start with a coded error carrying the url', async () => {
		const url = inject('endpoint')
		const transport = new SocketCDPTransport({ url })
		const refusal = await transport.send('{}').catch((error: unknown) => error)
		expect(isBrowserError(refusal) && refusal.code === 'CONNECTION' && refusal.code).toBe(
			'CONNECTION',
		)
		expect(isBrowserError(refusal) && refusal.code === 'CONNECTION' && refusal.context).toEqual({
			url,
		})
	})

	it('rejects start against a browser launched without --remote-allow-origins', async () => {
		const url = inject('endpointWithoutFlag')
		const transport = new SocketCDPTransport({ url })
		const refusal = await transport.start().catch((error: unknown) => error)
		expect(isBrowserError(refusal) && refusal.code === 'CONNECTION' && refusal.context).toEqual({
			url,
		})
		const second = await transport.send('{}').catch((error: unknown) => error)
		expect(isBrowserError(second) && second.code === 'CONNECTION').toBe(true)
	})

	it('rejects start for a URL that is not ws: or wss:, and for a malformed URL', async () => {
		const plain = new SocketCDPTransport({ url: 'http://127.0.0.1:9/devtools/browser/x' })
		const malformed = new SocketCDPTransport({ url: 'not a url' })
		const scheme = await plain.start().catch((error: unknown) => error)
		const parse = await malformed.start().catch((error: unknown) => error)
		expect(isBrowserError(scheme) && scheme.code === 'CONNECTION' && scheme.message).toMatch(
			/requires a ws: or wss:/,
		)
		expect(isBrowserError(parse) && parse.code === 'CONNECTION' && parse.message).toMatch(
			/URL is invalid/,
		)
	})

	it('codes a URL the WebSocket constructor refuses, one with a fragment', async () => {
		const url = 'ws://127.0.0.1:9222/#fragment'
		const refusal = await new SocketCDPTransport({ url }).start().catch((error: unknown) => error)
		expect(isBrowserError(refusal) && refusal.code === 'CONNECTION' && refusal.code).toBe(
			'CONNECTION',
		)
		expect(
			isBrowserError(refusal) && refusal.code === 'CONNECTION' && refusal.context,
		).toMatchObject({ url })
	})

	it('joins concurrent starts, closes on request, and starts a fresh socket after', async () => {
		const transport = new SocketCDPTransport({ url: inject('endpoint') })
		const closes = createRecorder<[]>()
		transport.emitter.on('close', closes.handler)
		await Promise.all([transport.start(), transport.start()])
		await transport.close()
		expect(closes.count).toBe(1)
		const refusal = await transport.send('{}').catch((error: unknown) => error)
		expect(isBrowserError(refusal) && refusal.code === 'CONNECTION').toBe(true)
		await transport.start()
		const messages = createRecorder<[string]>()
		transport.emitter.on('message', messages.handler)
		const answered = waitForEvent<[string]>((listener) => {
			transport.emitter.on('message', listener)
			return () => transport.emitter.off('message', listener)
		}, 'CDP answer')
		await transport.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }))
		const [frame] = await answered
		expect(JSON.parse(frame)).toMatchObject({ id: 1, result: { product: expect.any(String) } })
		await transport.close()
		await transport.close()
	})

	it('rejects a start that close interrupts', async () => {
		const transport = new SocketCDPTransport({ url: inject('endpoint') })
		const starting = transport.start()
		await transport.close()
		const refusal = await starting.catch((error: unknown) => error)
		expect(isBrowserError(refusal) && refusal.code === 'CONNECTION' && refusal.message).toMatch(
			/was closed before it finished connecting/,
		)
	})
})
