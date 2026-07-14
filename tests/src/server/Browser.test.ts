/**
 * Browser façade tests.
 *
 * Exercises discovery, connection, context sync, and lifecycle against an
 * in-process CDP test server (real HTTP + WebSocket sockets, no mocks — see
 * `createCdpTestServer` in `tests/setupServer.ts`). Flows that require a real
 * Chromium binary are `it.todo()`.
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
	createBrowser,
	BrowserDestroyedError,
	BrowserNotConnectedError,
	BrowserConnectionError,
} from '@src/server'
import { createCdpTestServer } from '../../setupServer.js'
import type { CDPTestServerInterface } from '../../setupServer.js'

// === Test scaffolding

let server: CDPTestServerInterface | undefined

afterEach(async () => {
	await server?.close()
	server = undefined
})

// A port nothing is listening on — used for "no CDP endpoint reachable" cases.
const UNUSED_PORT = 19_991

// === idle state

describe('Browser idle state', () => {
	it('starts in idle status', () => {
		const browser = createBrowser()
		expect(browser.status).toBe('idle')
		expect(browser.connected).toBe(false)
		expect(browser.connection).toBeUndefined()
	})

	it('defaults to chromium engine', () => {
		const browser = createBrowser()
		expect(browser.engine).toBe('chromium')
	})

	it('context() returns undefined before connect', () => {
		const browser = createBrowser()
		expect(browser.context()).toBeUndefined()
		expect(browser.context(0)).toBeUndefined()
	})

	it('context() with negative index returns undefined before connect', () => {
		const browser = createBrowser()
		expect(browser.context(-1)).toBeUndefined()
	})

	it('contexts() returns empty array before connect', () => {
		const browser = createBrowser()
		expect(browser.contexts()).toHaveLength(0)
	})

	it('contexts() returns a new array each time', () => {
		const browser = createBrowser()
		const a = browser.contexts()
		const b = browser.contexts()
		expect(a).not.toBe(b)
	})

	it('create() throws BrowserNotConnectedError when not connected', async () => {
		const browser = createBrowser()
		await expect(browser.create()).rejects.toThrow(BrowserNotConnectedError)
	})

	it('disconnect() is no-op when not connected', () => {
		const browser = createBrowser()
		browser.disconnect()
		expect(browser.status).toBe('idle')
	})

	it('discover() returns found:false when no CDP endpoint available', async () => {
		const browser = createBrowser({ cdp: { port: UNUSED_PORT } })
		const result = await browser.discover()
		expect(result.found).toBe(false)
		expect(result.endpoint).toBeUndefined()
		expect(result.browser).toBeUndefined()
		expect(result.connection).toBeUndefined()
	})

	it('discover() returns a well-shaped result', async () => {
		const browser = createBrowser({ cdp: { port: UNUSED_PORT } })
		const result = await browser.discover()
		expect(typeof result.found).toBe('boolean')
		expect('endpoint' in result).toBe(true)
		expect('browser' in result).toBe(true)
		expect('connection' in result).toBe(true)
	})

	it('discover() finds a reachable in-process CDP endpoint', async () => {
		server = await createCdpTestServer()
		const browser = createBrowser({ cdp: { port: server.port } })
		const result = await browser.discover()
		expect(result.found).toBe(true)
		expect(result.endpoint).toBe(server.wsUrl)
		expect(result.browser).toBe('Test/1.0')
		expect(result.connection).toBe('cdp')
	})

	it('discover() can be called multiple times without side effects', async () => {
		const browser = createBrowser({ cdp: { port: UNUSED_PORT } })
		const r1 = await browser.discover()
		const r2 = await browser.discover()
		expect(r1.found).toBe(false)
		expect(r2.found).toBe(false)
	})
})

// === destroyed state

describe('Browser destroyed state', () => {
	it('destroy() from idle is idempotent', async () => {
		const browser = createBrowser()
		await browser.destroy()
		await browser.destroy()
		expect(browser.connected).toBe(false)
	})

	it('connect() after destroy() throws BrowserDestroyedError', async () => {
		const browser = createBrowser()
		await browser.destroy()
		await expect(browser.connect()).rejects.toThrow(BrowserDestroyedError)
	})

	it('create() after destroy() throws BrowserDestroyedError', async () => {
		const browser = createBrowser()
		await browser.destroy()
		await expect(browser.create()).rejects.toThrow(BrowserDestroyedError)
	})

	it('disconnect() is no-op after destroy', async () => {
		const browser = createBrowser()
		await browser.destroy()
		browser.disconnect()
		expect(browser.connected).toBe(false)
	})

	it('context() returns undefined after destroy', async () => {
		const browser = createBrowser()
		await browser.destroy()
		expect(browser.context()).toBeUndefined()
	})

	it('contexts() returns empty after destroy', async () => {
		const browser = createBrowser()
		await browser.destroy()
		expect(browser.contexts()).toHaveLength(0)
	})

	it('discover() still works after destroy (passive probe)', async () => {
		const browser = createBrowser({ cdp: { port: UNUSED_PORT } })
		await browser.destroy()
		const result = await browser.discover()
		expect(result.found).toBe(false)
	})
})

// === abort handling

describe('Browser abort handling', () => {
	it('connect() with pre-aborted signal throws BrowserConnectionError', async () => {
		const controller = new AbortController()
		controller.abort()
		const browser = createBrowser({ signal: controller.signal })
		await expect(browser.connect()).rejects.toThrow(BrowserConnectionError)
	})

	it('connect() with pre-aborted signal leaves status as idle', async () => {
		const controller = new AbortController()
		controller.abort()
		const browser = createBrowser({ signal: controller.signal })
		try {
			await browser.connect()
		} catch {
			// expected
		}
		expect(browser.status).toBe('idle')
	})

	it('create() throws BrowserNotConnectedError after aborted connection', async () => {
		const controller = new AbortController()
		controller.abort()
		const browser = createBrowser({ signal: controller.signal })
		try {
			await browser.connect()
		} catch {
			// expected
		}
		await expect(browser.create()).rejects.toThrow(BrowserNotConnectedError)
	})
})

// === connect() via CDP discovery (in-process server, no real browser)

describe('Browser connect() via CDP discovery', () => {
	it('connects over CDP when the endpoint reports no targets', async () => {
		server = await createCdpTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()

		expect(browser.status).toBe('connected')
		expect(browser.connected).toBe(true)
		expect(browser.connection).toBe('cdp')
		expect(browser.contexts()).toHaveLength(0)

		await browser.destroy()
	})

	it('connect() is no-op when already connected', async () => {
		server = await createCdpTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()
		expect(browser.status).toBe('connected')
		await browser.connect()
		expect(browser.status).toBe('connected')

		await browser.destroy()
	})

	it('disconnect() detaches without closing the underlying connection state', async () => {
		server = await createCdpTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()
		expect(browser.connected).toBe(true)
		browser.disconnect()
		expect(browser.status).toBe('disconnected')
		expect(browser.connected).toBe(false)
		expect(browser.connection).toBeUndefined()
		await expect(browser.create()).rejects.toThrow(BrowserNotConnectedError)

		await browser.destroy()
	})

	it('can reconnect after disconnect', async () => {
		server = await createCdpTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()
		browser.disconnect()
		expect(browser.connected).toBe(false)

		await browser.connect()
		expect(browser.connected).toBe(true)

		await browser.destroy()
	})
})

// === syncContexts — existing targets attached on connect

describe('Browser syncContexts()', () => {
	it('syncs an existing page target into a context on connect', async () => {
		server = await createCdpTestServer()
		server.list([{ id: 'target-1', type: 'page', title: 'Existing', url: 'about:blank' }])
		server.autoReply('Target.attachToTarget', { sessionId: 'session-1' })
		server.autoReply('Page.enable', {})
		server.autoReply('Runtime.enable', {})
		server.autoReply('Target.closeTarget', {})

		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()

		expect(browser.contexts()).toHaveLength(1)
		expect(browser.context()).toBeDefined()
		expect(browser.context()?.pages()).toHaveLength(1)

		await browser.destroy()
	})

	it('ignores non-page targets when syncing', async () => {
		server = await createCdpTestServer()
		server.list([{ id: 'worker-1', type: 'worker', title: '', url: '' }])

		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()

		expect(browser.contexts()).toHaveLength(0)

		await browser.destroy()
	})
})

// === create() — page creation via the CDP test server

describe('Browser create()', () => {
	it('creates a page and emits the page event', async () => {
		server = await createCdpTestServer()
		server.list([])
		server.autoReply('Target.createTarget', { targetId: 'new-target' })
		server.autoReply('Target.attachToTarget', { sessionId: 'session-2' })
		server.autoReply('Page.enable', {})
		server.autoReply('Runtime.enable', {})
		server.autoReply('Target.closeTarget', {})

		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()

		let emitted: unknown
		browser.emitter.on('page', (page) => {
			emitted = page
		})

		const page = await browser.create()

		expect(page).toBeDefined()
		expect(emitted).toBe(page)
		expect(browser.contexts()).toHaveLength(1)

		await browser.destroy()
	})

	it('sends viewport metrics when a viewport option is provided', async () => {
		server = await createCdpTestServer()
		server.list([])
		server.autoReply('Target.createTarget', { targetId: 'new-target' })
		server.autoReply('Target.attachToTarget', { sessionId: 'session-3' })
		server.autoReply('Page.enable', {})
		server.autoReply('Runtime.enable', {})
		server.autoReply('Emulation.setDeviceMetricsOverride', {})
		server.autoReply('Target.closeTarget', {})

		const browser = createBrowser({
			cdp: { port: server.port },
			viewport: { width: 800, height: 600 },
		})
		await browser.connect()
		await browser.create()

		const metrics = server.received.find((m) => m.method === 'Emulation.setDeviceMetricsOverride')
		expect(metrics?.params?.['width']).toBe(800)
		expect(metrics?.params?.['height']).toBe(600)

		await browser.destroy()
	})

	it.todo('creates a page and navigates it in a real browser')
	it.todo('screenshot returns real PNG bytes from a real browser page')
})

// === launch path — executable resolution failure (no real browser spawned)

describe('Browser launch path', () => {
	it('connect() throws BrowserConnectionError when the executable does not exist', async () => {
		const browser = createBrowser({
			cdp: { port: UNUSED_PORT },
			executable: '/nonexistent/path/to/chrome-does-not-exist',
		})
		await expect(browser.connect()).rejects.toThrow(BrowserConnectionError)
		expect(browser.status).toBe('error')
	})

	it.todo('launches a real system Chromium and transitions to connected')
	it.todo('connect() with a profile launches with a persistent user-data dir')
	it.todo('accepts explicit headless option against a real launch')
})

// === destroy ordering

describe('Browser destroy() ordering', () => {
	it('emits destroy once and destroys the emitter last', async () => {
		server = await createCdpTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()

		let destroyCount = 0
		browser.emitter.on('destroy', () => {
			destroyCount++
		})

		await browser.destroy()

		expect(destroyCount).toBe(1)
		expect(browser.emitter.destroyed).toBe(true)
		expect(browser.connected).toBe(false)
	})

	it('destroy() after disconnect is idempotent', async () => {
		server = await createCdpTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()
		browser.disconnect()
		await browser.destroy()
		await browser.destroy()
		expect(browser.connected).toBe(false)
	})
})

// === createBrowser factory

describe('createBrowser', () => {
	it('returns a BrowserInterface', () => {
		const browser = createBrowser()
		expect(browser.engine).toBe('chromium')
		expect(browser.status).toBe('idle')
		expect(typeof browser.connect).toBe('function')
		expect(typeof browser.disconnect).toBe('function')
		expect(typeof browser.discover).toBe('function')
		expect(typeof browser.create).toBe('function')
		expect(typeof browser.destroy).toBe('function')
		expect(typeof browser.context).toBe('function')
		expect(typeof browser.contexts).toBe('function')
	})

	it('accepts all options', () => {
		const browser = createBrowser({
			headless: false,
			executable: '/usr/bin/chromium',
			profile: '/tmp/profile',
			cdp: { port: 9333, endpoint: 'ws://localhost:9333' },
			timeout: 60_000,
			viewport: { width: 1920, height: 1080 },
			signal: new AbortController().signal,
			args: ['--no-sandbox'],
		})
		expect(browser.engine).toBe('chromium')
	})

	it('accepts no options (defaults)', () => {
		const browser = createBrowser()
		expect(browser.engine).toBe('chromium')
	})

	it('each call returns a new instance', () => {
		const a = createBrowser()
		const b = createBrowser()
		expect(a).not.toBe(b)
	})

	it('accepts empty options object', () => {
		const browser = createBrowser({})
		expect(browser.engine).toBe('chromium')
		expect(browser.status).toBe('idle')
	})

	it('connected is false on fresh instance', () => {
		const browser = createBrowser()
		expect(browser.connected).toBe(false)
	})

	it('connection is undefined on fresh instance', () => {
		const browser = createBrowser()
		expect(browser.connection).toBeUndefined()
	})
})

// === Events

describe('Browser events', () => {
	it('inherits emitter interface methods', () => {
		const browser = createBrowser()
		expect(browser.emitter.destroyed).toBe(false)
		expect(typeof browser.emitter.on).toBe('function')
		expect(typeof browser.emitter.once).toBe('function')
		expect(typeof browser.emitter.off).toBe('function')
		expect(typeof browser.emitter.emit).toBe('function')
		expect(typeof browser.emitter.count).toBe('function')
		expect(typeof browser.emitter.clear).toBe('function')
	})

	it('wires construction-time hooks via the on option', () => {
		const browser = createBrowser({ on: { discover: () => {} } })
		expect(browser.emitter.count('discover')).toBe(1)
	})

	it('emits idle event after construction', async () => {
		let idled = false
		createBrowser({ on: { idle: () => (idled = true) } })
		await new Promise((resolve) => queueMicrotask(() => resolve(undefined)))
		expect(idled).toBe(true)
	})

	it('emits idle event on disconnect', async () => {
		server = await createCdpTestServer()
		server.list([])
		let idleCount = 0
		const browser = createBrowser({ cdp: { port: server.port }, on: { idle: () => idleCount++ } })
		await new Promise((resolve) => queueMicrotask(() => resolve(undefined)))
		const initialCount = idleCount

		await browser.connect()
		browser.disconnect()

		expect(idleCount).toBeGreaterThan(initialCount)
		await browser.destroy()
	})

	it('emits discover event', async () => {
		let discovered = false
		const browser = createBrowser({
			cdp: { port: UNUSED_PORT },
			on: { discover: () => (discovered = true) },
		})
		await browser.discover()
		expect(discovered).toBe(true)
	})

	it('emits destroy event on destroy()', async () => {
		let destroyed = false
		const browser = createBrowser({ on: { destroy: () => (destroyed = true) } })
		await browser.destroy()
		expect(destroyed).toBe(true)
	})

	it('supports runtime on/off subscription', () => {
		const browser = createBrowser()
		const handler = (): void => {}
		browser.emitter.on('disconnect', handler)
		expect(browser.emitter.count('disconnect')).toBe(1)
		browser.emitter.off('disconnect', handler)
		expect(browser.emitter.count('disconnect')).toBe(0)
	})

	it('once fires exactly one time then removes', () => {
		const browser = createBrowser()
		browser.emitter.once('disconnect', () => {})
		expect(browser.emitter.count('disconnect')).toBe(1)
	})
})
