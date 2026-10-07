/**
 * src/server/factories.ts tests.
 *
 * `createFileBrowserWriter` writes real bytes to a real temp directory (no
 * fake filesystem). `createWebSocketCDPTransport` and `createBrowser` are checked for
 * shape and real connectivity against the in-process CDP test server.
 */

import type { ScratchInterface } from '@orkestrel/test/server'
import type { CDPTestServerInterface } from '../../setupServer.js'
import { describe, it, expect, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createScratch } from '@orkestrel/test/server'
import {
	createFileBrowserJourneyStore,
	createFileBrowserRunStore,
	createBrowser,
	createWebSocketCDPTransport,
	createFileBrowserWriter,
} from '@src/server'
import { BROWSER_RUN_FIXTURE, createBrowserJourneyFixture } from '../../setup.js'
import { createCDPTestServer } from '../../setupServer.js'

let server: CDPTestServerInterface | undefined
let scratch: ScratchInterface | undefined

afterEach(async () => {
	await server?.close()
	server = undefined
	scratch?.destroy()
	scratch = undefined
})

describe('createFileBrowserWriter', () => {
	it('writes real bytes to a real file, creating parent dirs', async () => {
		scratch = createScratch({ prefix: 'scsr-screenshot-' })
		const writer = createFileBrowserWriter()
		const path = join(scratch.path, 'nested', 'shot.png')
		const bytes = new Uint8Array([137, 80, 78, 71])

		await writer.write(path, bytes)

		const written = await readFile(path)
		expect(new Uint8Array(written)).toEqual(bytes)
	})

	it('overwrites an existing file at the same path', async () => {
		scratch = createScratch({ prefix: 'scsr-screenshot-' })
		const writer = createFileBrowserWriter()
		const path = join(scratch.path, 'shot.png')

		await writer.write(path, new Uint8Array([1, 2, 3]))
		await writer.write(path, new Uint8Array([4, 5]))

		const written = await readFile(path)
		expect(new Uint8Array(written)).toEqual(new Uint8Array([4, 5]))
	})
})

describe('createWebSocketCDPTransport', () => {
	it('returns a CDPTransportInterface shape', () => {
		const transport = createWebSocketCDPTransport({ url: 'ws://localhost:1/cdp' })
		expect(transport.emitter).toBeDefined()
		expect(typeof transport.start).toBe('function')
		expect(typeof transport.send).toBe('function')
		expect(typeof transport.close).toBe('function')
	})

	it('connects to a real in-process CDP WebSocket endpoint', async () => {
		server = await createCDPTestServer()
		const transport = createWebSocketCDPTransport({ url: server.endpoint })
		await transport.start()
		await expect(transport.send('{}')).resolves.toBeUndefined()
		await transport.close()
	})
})

describe('createBrowser', () => {
	it('returns a BrowserInterface shape', () => {
		const browser = createBrowser()
		expect(browser.engine).toBe('chromium')
		expect(browser.status).toBe('idle')
		expect(browser.emitter).toBeDefined()
		expect(typeof browser.discover).toBe('function')
		expect(typeof browser.connect).toBe('function')
		expect(typeof browser.disconnect).toBe('function')
		expect(typeof browser.context).toBe('function')
		expect(typeof browser.contexts).toBe('function')
		expect(typeof browser.create).toBe('function')
		expect(typeof browser.destroy).toBe('function')
	})
})

describe('file store factories', () => {
	it('creates a journey store that persists a revision', async () => {
		scratch = createScratch()
		const store = createFileBrowserJourneyStore({ root: scratch.path })
		const saved = await store.set(createBrowserJourneyFixture())
		expect(
			await createFileBrowserJourneyStore({ root: scratch.path }).get(saved.journey.name),
		).toEqual(saved)
	})
	it('creates a run store that allocates and persists a run', async () => {
		scratch = createScratch()
		const store = createFileBrowserRunStore({ root: scratch.path })
		const slot = await store.open(BROWSER_RUN_FIXTURE.journey.name)
		const run = { ...BROWSER_RUN_FIXTURE, id: slot.id }
		await store.set(run)
		expect(
			await createFileBrowserRunStore({ root: scratch.path }).get(run.journey.name, run.id),
		).toEqual(run)
	})
})
