/**
 * src/core/factories.ts tests.
 *
 * `createCDPClient` is checked for shape and real wiring to the fake
 * transport from `tests/setup.ts` — the exhaustive request/response
 * behavior of the client itself is covered by `CDPClient.test.ts`.
 */

import type { CDPClientInterface } from '@src/core'
import type { CDPTestTransportInterface } from '../../setup.js'
import {
	BrowserRecorder,
	BrowserReplay,
	MemoryBrowserJourneyStore,
	MemoryBrowserRunStore,
	createBrowserRecorder,
	createBrowserReplay,
	createMemoryBrowserJourneyStore,
	createMemoryBrowserRunStore,
	BrowserToolset,
	createBrowserToolset,
	createBrowserContext,
	isBrowserError,
	createCDPClient,
} from '@src/core'
import {
	createBrowserViewDouble,
	createBrowserJourneyFixture,
	createBrowserElementFixture,
	createCDPTestTransport,
	replyOk,
	createConnectedCDPClient,
	scriptCDPAttach,
	createRecordingWriter,
} from '../../setup.js'
import { captureError } from '@orkestrel/test'
import { describe, it, expect } from 'vitest'
import { createToolManager } from '@orkestrel/tool'
describe('createCDPClient', () => {
	it('returns a CDPClientInterface shape', () => {
		const transport = createCDPTestTransport()
		const client = createCDPClient({ transport })

		expect(client.connected).toBe(false)
		expect(typeof client.connect).toBe('function')
		expect(typeof client.reconnect).toBe('function')
		expect(typeof client.send).toBe('function')
		expect(typeof client.subscribe).toBe('function')
		expect(typeof client.unsubscribe).toBe('function')
		expect(typeof client.close).toBe('function')
	})

	it('connect() starts the provided transport', async () => {
		const transport: CDPTestTransportInterface = createCDPTestTransport()
		const client: CDPClientInterface = createCDPClient({ transport })

		expect(transport.started).toBe(false)
		await client.connect()
		expect(transport.started).toBe(true)
		expect(client.connected).toBe(true)
	})

	it('send() routes the request through the provided transport', async () => {
		const transport = createCDPTestTransport()
		const client = createCDPClient({ transport })
		await client.connect()
		replyOk(transport, 'Target.getTargets', { targetInfos: [] })

		const result = await client.send('Target.getTargets')

		expect(result).toEqual({ targetInfos: [] })
		expect(transport.sent).toHaveLength(1)
		expect(transport.sent[0]?.method).toBe('Target.getTargets')
	})

	it('connected reflects the client lifecycle across connect and close', async () => {
		const transport = createCDPTestTransport()
		const client = createCDPClient({ transport })

		expect(client.connected).toBe(false)
		await client.connect()
		expect(client.connected).toBe(true)
		await client.close()
		expect(client.connected).toBe(false)
	})
})

describe('createBrowserToolset', () => {
	it('catches a factory that ignores the supplied manager or fills it before start', async () => {
		const { client, page } = await createBrowserElementFixture()
		try {
			const tools = createToolManager()
			const toolset = createBrowserToolset(page, { tools })
			expect(toolset).toBeInstanceOf(BrowserToolset)
			expect(toolset.tools.emitter).toBe(tools.emitter)
			expect(tools.count).toBe(0)
			await toolset.start()
			expect(tools.tools()).toEqual(toolset.native)
			await toolset.destroy()
			expect(tools.count).toBe(0)
		} finally {
			await client.close()
		}
	})
})

describe('createBrowserContext', () => {
	it.each(['destroy', 'close'] as const)(
		'leaves the supplied client connected after %s',
		async (operation) => {
			const { client, transport } = await createConnectedCDPClient()
			replyOk(transport, 'Target.disposeBrowserContext')
			try {
				await createBrowserContext(client, { id: 'owned-remotely' })[operation]()
				expect(client.connected).toBe(true)
			} finally {
				await client.close()
			}
		},
	)
	it('threads the context id, viewport, writer, and hooks while leaving the client caller-owned', async () => {
		const { client, transport } = await createConnectedCDPClient()
		scriptCDPAttach(transport)
		replyOk(transport, 'Target.createTarget', { targetId: 'factory-page' })
		replyOk(transport, 'Emulation.setDeviceMetricsOverride')
		replyOk(transport, 'Target.detachFromTarget')
		const writer = createRecordingWriter()
		let announced = ''
		const context = createBrowserContext(client, {
			id: 'factory-context',
			viewport: { width: 640, height: 480 },
			writer,
			on: {
				page: (page) => {
					announced = page.target
				},
			},
		})
		try {
			const page = await context.create()
			expect(announced).toBe('factory-page')
			expect(context.id).toBe('factory-context')
			expect(
				transport.sent.find((entry) => entry.method === 'Target.createTarget')?.params,
			).toEqual({ url: 'about:blank', browserContextId: 'factory-context' })
			expect(
				transport.sent.find((entry) => entry.method === 'Emulation.setDeviceMetricsOverride')
					?.params,
			).toMatchObject({ width: 640, height: 480 })
			const bytes = new Uint8Array([7, 8])
			replyOk(transport, 'Page.captureScreenshot', { data: 'Bwg=' })
			await page.screenshot({ path: 'capture.bin' })
			expect(writer.calls).toEqual([{ path: 'capture.bin', data: bytes }])
			await context.destroy()
			expect(client.connected).toBe(true)
		} finally {
			await client.close()
			await context.destroy()
		}
	})

	it('wraps the default context and refuses creation-only options before protocol work', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const context = createBrowserContext(client)
		try {
			expect(context.id).toBeUndefined()
			expect(context.pages()).toEqual([])
			const proxyOptions = { id: 'wrapped', proxy: { server: 'http://proxy.test' } }
			const originOptions = { id: 'wrapped', origins: [] }
			const proxy = captureError(() => createBrowserContext(client, proxyOptions))
			const origins = captureError(() => createBrowserContext(client, originOptions))
			const viewport = captureError(() =>
				createBrowserContext(client, { viewport: { width: 0, height: 480 } }),
			)
			expect(isBrowserError(proxy) && proxy.code).toBe('ARGUMENT')
			expect(isBrowserError(origins) && origins.code).toBe('ARGUMENT')
			expect(isBrowserError(viewport) && viewport.code).toBe('ARGUMENT')
			expect(transport.sent).toEqual([])
		} finally {
			await client.close()
			await context.destroy()
		}
	})
})

describe('journey factories', () => {
	it('constructs recorders, replays, and memory stores with their supplied options', async () => {
		const toolset = new BrowserToolset(createBrowserViewDouble())
		await toolset.start()
		const recorder = createBrowserRecorder(toolset)
		const store = createMemoryBrowserJourneyStore()
		const runs = createMemoryBrowserRunStore()
		try {
			expect(recorder).toBeInstanceOf(BrowserRecorder)
			expect(store).toBeInstanceOf(MemoryBrowserJourneyStore)
			expect(runs).toBeInstanceOf(MemoryBrowserRunStore)
			await recorder.start()
			const journey = createBrowserJourneyFixture(
				[{ action: 'wait', arguments: { text: { parameter: 'status' } } }],
				{ parameters: { status: {} } },
			)
			const revision = await store.set(journey)
			const replay = createBrowserReplay(toolset, revision, { inputs: { status: 'Ready' }, runs })
			expect(replay).toBeInstanceOf(BrowserReplay)
			const run = await replay.execute()
			expect(run.outcome).toBe('complete')
			expect(await runs.get(journey.name, run.id)).toEqual(run)
			expect((await recorder.stop())[0]?.gap).toBe('replayed check-ready')
		} finally {
			await recorder.destroy()
			await toolset.destroy()
		}
	})
})
