/**
 * src/server/factories.ts tests.
 *
 * `createScreenshotWriter` writes real bytes to a real temp directory (no
 * fake filesystem). `createCDPTransport` and `createBrowser` are checked for
 * shape and real connectivity against the in-process CDP test server.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBrowser, createCDPTransport, createScreenshotWriter } from '@src/server'
import { createCdpTestServer } from '../../setupServer.js'
import type { CDPTestServerInterface } from '../../setupServer.js'

let server: CDPTestServerInterface | undefined
let tempDir: string | undefined

afterEach(async () => {
	await server?.close()
	server = undefined
	if (tempDir !== undefined) {
		await rm(tempDir, { recursive: true, force: true })
		tempDir = undefined
	}
})

describe('createScreenshotWriter', () => {
	it('writes real bytes to a real file, creating parent dirs', async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'scsr-screenshot-'))
		const writer = createScreenshotWriter()
		const path = join(tempDir, 'nested', 'shot.png')
		const bytes = new Uint8Array([137, 80, 78, 71])

		await writer.write(path, bytes)

		const written = await readFile(path)
		expect(new Uint8Array(written)).toEqual(bytes)
	})

	it('overwrites an existing file at the same path', async () => {
		tempDir = await mkdtemp(join(tmpdir(), 'scsr-screenshot-'))
		const writer = createScreenshotWriter()
		const path = join(tempDir, 'shot.png')

		await writer.write(path, new Uint8Array([1, 2, 3]))
		await writer.write(path, new Uint8Array([4, 5]))

		const written = await readFile(path)
		expect(new Uint8Array(written)).toEqual(new Uint8Array([4, 5]))
	})
})

describe('createCDPTransport', () => {
	it('returns a CDPTransportInterface shape', () => {
		const transport = createCDPTransport({ url: 'ws://localhost:1/cdp' })
		expect(transport.emitter).toBeDefined()
		expect(typeof transport.start).toBe('function')
		expect(typeof transport.send).toBe('function')
		expect(typeof transport.close).toBe('function')
	})

	it('connects to a real in-process CDP WebSocket endpoint', async () => {
		server = await createCdpTestServer()
		const transport = createCDPTransport({ url: server.wsUrl })
		await transport.start()
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
