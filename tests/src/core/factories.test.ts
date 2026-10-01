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
	createCDPClient,
} from '@src/core'
import {
	createBrowserViewDouble,
	createBrowserJourneyFixture,
	createBrowserElementFixture,
	createCDPTestTransport,
	replyOk,
} from '../../setup.js'
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
			expect(toolset.tools).toBe(tools)
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
