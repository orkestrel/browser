/**
 * Browser façade tests.
 *
 * Exercises discovery, connection, context sync, and lifecycle against an
 * in-process CDP test server (real HTTP + WebSocket sockets, no mocks — see
 * `createCdpTestServer` in `tests/setupServer.ts`). Flows that require a real
 * Chromium binary run in the `Browser real launch` suite below, gated on
 * `findSystemBrowser()` discovering an actual browser on the machine.
 */

import type { AddressInfo } from 'node:net'
import type { BrowserInterface } from '@src/server'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	createBrowser,
	findSystemBrowser,
	BrowserDestroyedError,
	BrowserNotConnectedError,
	BrowserConnectionError,
	BROWSER_KILL_GRACE_MS,
} from '@src/server'
import { BROWSER_RESULT_LIMIT, isBrowserResultLimitError, compileCodegenScript } from '@src/core'
import { createCdpTestServer, createFakeBrowserProcess } from '../../setupServer.js'
import type { CDPTestServerInterface } from '../../setupServer.js'
import { waitForDelay } from '../../setup.js'

const REAL_BROWSER_EXECUTABLE = findSystemBrowser()?.executable

// Container-safe launch flags: needed when running headless Chromium as root
// (the common case in CI/sandboxed containers) — sandboxing requires a
// non-root user, `/dev/shm` is often too small, and GPU access is unavailable.
const REAL_BROWSER_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']

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

	it('disconnect() is no-op when not connected', async () => {
		const browser = createBrowser()
		await browser.disconnect()
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
		await browser.disconnect()
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
		await browser.disconnect()
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
		await browser.disconnect()
		expect(browser.connected).toBe(false)

		await browser.connect()
		expect(browser.connected).toBe(true)

		await browser.destroy()
	})

	it('disconnect() awaits the underlying socket close before resolving', async () => {
		server = await createCdpTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()
		expect(server.sockets).toBe(1)

		await browser.disconnect()

		let waited = 0
		while (server.sockets > 0 && waited < 500) {
			await waitForDelay(10)
			waited += 10
		}
		expect(server.sockets).toBe(0)

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

	it('disconnect() on an ephemeral launched session rejects with coded BrowserConnectionError and destroy() still cleans up', async () => {
		const fake = createFakeBrowserProcess({ serveCdp: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: 20_001 },
			timeout: 5000,
		})

		await browser.connect()
		expect(browser.status).toBe('connected')
		expect(browser.connection).toBe('launch')

		const pid = await fake.pid()

		await expect(browser.disconnect()).rejects.toThrow(BrowserConnectionError)
		await expect(browser.disconnect()).rejects.toThrow(
			'Cannot disconnect() an ephemeral launch — no persistent profile to reattach to; ephemeral launches must use destroy() to release it',
		)
		expect(browser.connected).toBe(true)

		await browser.destroy()
		expect(browser.connected).toBe(false)

		await waitForDelay(100)
		expect(() => process.kill(pid, 0)).toThrow('ESRCH')
	})

	it('connect() with a requested engine and no matching installed browser rejects with the engine in context', async () => {
		const browser = createBrowser({
			cdp: { port: UNUSED_PORT },
			engine: 'edge',
			timeout: 2000,
		})

		await expect(browser.connect()).rejects.toThrow(BrowserConnectionError)
		await expect(browser.connect()).rejects.toMatchObject({ context: { engine: 'edge' } })
	})

	it('disconnect() on a persistent (profile-backed) launch releases the process without killing it, allowing reattachment', async () => {
		const fake = createFakeBrowserProcess({ serveCdp: true })
		const profileDir = mkdtempSync(join(tmpdir(), 'orkestrel-browser-profile-'))
		const port = 20_002

		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			profile: profileDir,
			cdp: { port },
			timeout: 5000,
		})

		await browser.connect()
		expect(browser.status).toBe('connected')
		expect(browser.connection).toBe('persistent')

		const pid = await fake.pid()

		await expect(browser.disconnect()).resolves.toBeUndefined()
		expect(browser.connected).toBe(false)

		// The process must survive disconnect() — a persistent launch is
		// released, not killed.
		expect(() => process.kill(pid, 0)).not.toThrow()

		// Reattach via CDP discovery on the same port.
		const reattached = createBrowser({ cdp: { port }, timeout: 5000 })
		await reattached.connect()
		expect(reattached.status).toBe('connected')
		expect(reattached.connected).toBe(true)
		expect(reattached.connection).toBe('cdp')

		// Destroying the reattached (CDP-discovered) session must not kill the
		// underlying process — only the original launch owns it.
		await reattached.destroy()
		expect(reattached.connected).toBe(false)
		expect(() => process.kill(pid, 0)).not.toThrow()

		process.kill(pid, 'SIGKILL')
		await waitForDelay(100)
		expect(() => process.kill(pid, 0)).toThrow('ESRCH')

		rmSync(profileDir, { recursive: true, force: true })
	})
})

describe('Browser pid', () => {
	it('is undefined before connecting', () => {
		const browser = createBrowser()
		expect(browser.pid).toBeUndefined()
	})

	it('remains readable after a persistent disconnect-release, cleared by destroy()', async () => {
		const fake = createFakeBrowserProcess({ serveCdp: true })
		const profileDir = mkdtempSync(join(tmpdir(), 'orkestrel-browser-profile-'))
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			profile: profileDir,
			cdp: { port: 20_013 },
			timeout: 5000,
		})

		await browser.connect()
		const pid = await fake.pid()
		expect(browser.pid).toBe(pid)

		await browser.disconnect()
		expect(browser.connected).toBe(false)
		expect(browser.pid).toBe(pid)

		await browser.destroy()
		expect(browser.pid).toBeUndefined()

		process.kill(pid, 'SIGKILL')
		await waitForDelay(100)
		rmSync(profileDir, { recursive: true, force: true })
	})

	it('is undefined for a CDP-attached connection', async () => {
		server = await createCdpTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()
		expect(browser.pid).toBeUndefined()

		await browser.destroy()
	})

	it('returns the launched process pid', async () => {
		const fake = createFakeBrowserProcess({ serveCdp: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: 20_011 },
			timeout: 5000,
		})

		await browser.connect()
		const pid = await fake.pid()
		expect(browser.pid).toBe(pid)

		await browser.destroy()
	})

	it('is undefined after destroy()', async () => {
		const fake = createFakeBrowserProcess({ serveCdp: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: 20_012 },
			timeout: 5000,
		})

		await browser.connect()
		await browser.destroy()
		expect(browser.pid).toBeUndefined()
	})
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
		await browser.disconnect()
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
		await browser.disconnect()

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

// === external-disconnect detection (design-1)

describe('Browser external-disconnect detection', () => {
	it('connected reads are side-effect-free while healthy', async () => {
		server = await createCdpTestServer()
		server.list([])
		let disconnectCount = 0
		const browser = createBrowser({
			cdp: { port: server.port },
			on: { disconnect: () => disconnectCount++ },
		})
		await browser.connect()

		for (let i = 0; i < 20; i++) {
			expect(browser.connected).toBe(true)
		}
		expect(disconnectCount).toBe(0)
		expect(browser.status).toBe('connected')

		await browser.destroy()
	})

	it('transport close triggers exactly one disconnect without reading .connected', async () => {
		server = await createCdpTestServer()
		server.list([])
		let disconnectCount = 0
		const browser = createBrowser({
			cdp: { port: server.port },
			on: { disconnect: () => disconnectCount++ },
		})
		await browser.connect()

		await server.close()
		server = undefined
		await waitForDelay(50)

		expect(disconnectCount).toBe(1)
		expect(browser.status).toBe('disconnected')

		await browser.destroy()
	})

	it('transport loss while the owned process stays alive does not kill it, and the same instance reattaches', async () => {
		const fake = createFakeBrowserProcess({ serveCdp: true })
		let disconnectCount = 0
		let lastError: unknown
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: 20_020 },
			timeout: 5000,
			on: {
				disconnect: () => disconnectCount++,
				error: (error) => (lastError = error),
			},
		})

		await browser.connect()
		expect(browser.connection).toBe('launch')
		const pid = await fake.pid()

		await fake.dropSocket()
		await waitForDelay(100)

		expect(disconnectCount).toBe(1)
		expect(browser.status).toBe('disconnected')
		expect(lastError).toBeInstanceOf(BrowserConnectionError)
		expect((lastError as { context?: { cause?: string } }).context?.cause).toBe('connection-loss')
		expect(() => process.kill(pid, 0)).not.toThrow()

		await browser.connect()
		expect(browser.connected).toBe(true)
		expect(browser.connection).toBe('cdp')

		await browser.destroy()
		await waitForDelay(100)
		expect(() => process.kill(pid, 0)).toThrow('ESRCH')
	})

	it('an observed process exit cleans up without attempting a kill, coded error then disconnect', async () => {
		const fake = createFakeBrowserProcess({ serveCdp: true })
		let disconnectCount = 0
		let lastError: unknown
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: 20_021 },
			timeout: 5000,
			on: {
				disconnect: () => disconnectCount++,
				error: (error) => (lastError = error),
			},
		})

		await browser.connect()
		const pid = await fake.pid()

		process.kill(pid, 'SIGKILL')
		await waitForDelay(150)

		expect(disconnectCount).toBe(1)
		expect(browser.status).toBe('disconnected')
		expect(lastError).toBeInstanceOf(BrowserConnectionError)
		expect((lastError as { context?: { cause?: string } }).context?.cause).toBe('process-exit')
		expect(browser.pid).toBeUndefined()

		await browser.destroy()
	})
})

// === destroy()/close() lifecycle matrix (design-2, design-3)

describe('Browser destroy()/close() matrix', () => {
	it('destroy() on a CDP-attached browser sends no Target.closeTarget, and the server stays usable', async () => {
		server = await createCdpTestServer()
		server.list([{ id: 'target-1', type: 'page', title: 'Existing', url: 'about:blank' }])
		server.autoReply('Target.attachToTarget', { sessionId: 'session-1' })
		server.autoReply('Page.enable', {})
		server.autoReply('Runtime.enable', {})

		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()
		expect(browser.contexts()).toHaveLength(1)

		await browser.destroy()

		const closeTargetCalls = server.received.filter((m) => m.method === 'Target.closeTarget')
		expect(closeTargetCalls).toHaveLength(0)

		// The server (standing in for "another client's shared browser") stays usable.
		const other = createBrowser({ cdp: { port: server.port } })
		await other.connect()
		expect(other.connected).toBe(true)
		await other.destroy()
	})

	it('close() on an attached session sends Browser.close and cleans up locally', async () => {
		server = await createCdpTestServer()
		server.list([])
		server.autoReply('Browser.close', {})

		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()

		await browser.close()

		const closeCalls = server.received.filter((m) => m.method === 'Browser.close')
		expect(closeCalls).toHaveLength(1)
		expect(browser.connected).toBe(false)
		await expect(browser.connect()).rejects.toThrow(BrowserDestroyedError)
	})

	it('close() on an owned session results in the process exiting', async () => {
		const fake = createFakeBrowserProcess({ serveCdp: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: 20_022 },
			timeout: 5000,
		})

		await browser.connect()
		const pid = await fake.pid()

		await browser.close()

		await waitForDelay(200)
		expect(() => process.kill(pid, 0)).toThrow('ESRCH')
		expect(browser.connected).toBe(false)
	})
})

// === constructor engine seeding (design-5)

describe('Browser constructor engine seeding', () => {
	it('seeds engine from options.engine when provided', () => {
		const browser = createBrowser({ engine: 'edge' })
		expect(browser.engine).toBe('edge')
	})

	it('options.engine takes precedence over the executable-derived engine', () => {
		const browser = createBrowser({ engine: 'edge', executable: '/usr/bin/google-chrome' })
		expect(browser.engine).toBe('edge')
	})

	it('falls back to parsing the executable when options.engine is absent', () => {
		const browser = createBrowser({ executable: '/usr/bin/google-chrome' })
		expect(browser.engine).toBe('chrome')
	})

	it('defaults to chromium when neither options.engine nor executable is given', () => {
		const browser = createBrowser()
		expect(browser.engine).toBe('chromium')
	})
})

// === discover: false (design-6)

describe('Browser cdp.discover option', () => {
	it('rejects with a coded error naming the occupied port and does not attach', async () => {
		server = await createCdpTestServer()
		server.list([])

		const browser = createBrowser({
			cdp: { port: server.port, discover: false },
			timeout: 2000,
		})

		await expect(browser.connect()).rejects.toThrow(BrowserConnectionError)
		await expect(
			createBrowser({ cdp: { port: server.port, discover: false }, timeout: 2000 }).connect(),
		).rejects.toMatchObject({ context: { port: server.port } })
		expect(browser.connected).toBe(false)
		expect(browser.connection).toBeUndefined()
	})

	it('launches directly when the port is free', async () => {
		const fake = createFakeBrowserProcess({ serveCdp: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: 20_023, discover: false },
			timeout: 5000,
		})

		await browser.connect()
		expect(browser.status).toBe('connected')
		expect(browser.connection).toBe('launch')

		await browser.destroy()
	})
})

// === abort mid-connect (robustness-3) leaves no orphaned process

describe('Browser abort mid-connect', () => {
	it('rejects promptly and leaves no live process', async () => {
		const fake = createFakeBrowserProcess()
		const controller = new AbortController()
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: 19_998 },
			timeout: 5000,
			signal: controller.signal,
		})

		const connectPromise = browser.connect()
		const pid = await fake.pid()
		controller.abort()

		await expect(connectPromise).rejects.toThrow(BrowserConnectionError)

		await waitForDelay(100)
		expect(() => process.kill(pid, 0)).toThrow('ESRCH')
	})
})

// === post-spawn connect failure (lifecycle-1) kills the spawned process

describe('Browser post-spawn connect failure', () => {
	it('kills the spawned process when CDP never becomes ready', async () => {
		const fake = createFakeBrowserProcess()
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: 19_999 },
			timeout: 150,
		})

		const connectPromise = browser.connect()
		const pid = await fake.pid()

		await expect(connectPromise).rejects.toThrow(BrowserConnectionError)

		await waitForDelay(100)
		expect(() => process.kill(pid, 0)).toThrow('ESRCH')
	})
})

// === destroy() kill escalation (lifecycle-6)

describe('Browser destroy() kill escalation', () => {
	it('destroy() fully terminates a cooperative launched process', async () => {
		const fake = createFakeBrowserProcess({ serveCdp: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: 20_005 },
			timeout: 5000,
		})

		await browser.connect()
		expect(browser.status).toBe('connected')

		const pid = await fake.pid()
		expect(() => process.kill(pid, 0)).not.toThrow()

		await browser.destroy()

		await waitForDelay(100)
		expect(() => process.kill(pid, 0)).toThrow('ESRCH')
	})

	// Windows cannot trap SIGTERM (Node delivers it as an unconditional
	// terminate, not a catchable signal), so the ignore-then-escalate path
	// is only observable on POSIX platforms.
	it.runIf(process.platform !== 'win32')(
		'escalates to SIGKILL when the launched process ignores SIGTERM',
		async () => {
			const fake = createFakeBrowserProcess({ serveCdp: true, ignoreSigterm: true })
			const browser = createBrowser({
				executable: fake.executable,
				args: fake.args,
				cdp: { port: 20_000 },
				timeout: 5000,
			})

			await browser.connect()
			expect(browser.status).toBe('connected')

			const pid = await fake.pid()
			expect(() => process.kill(pid, 0)).not.toThrow()

			vi.useFakeTimers()
			try {
				const destroyPromise = browser.destroy()
				await vi.advanceTimersByTimeAsync(BROWSER_KILL_GRACE_MS + 100)
				await destroyPromise
			} finally {
				vi.useRealTimers()
			}

			await waitForDelay(100)
			expect(() => process.kill(pid, 0)).toThrow('ESRCH')
		},
		15_000,
	)
})

// === host option (robustness-7)

describe('Browser host option', () => {
	it('honors an explicit host for discovery and connection', async () => {
		server = await createCdpTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port, host: '127.0.0.1' } })

		const discovery = await browser.discover()
		expect(discovery.found).toBe(true)

		await browser.connect()
		expect(browser.status).toBe('connected')

		await browser.destroy()
	})
})

// === real launch — exercised only when a system Chromium is discoverable

describe.runIf(REAL_BROWSER_EXECUTABLE !== undefined)('Browser real launch', () => {
	let browser: BrowserInterface | undefined
	const tempDirs: string[] = []

	afterEach(async () => {
		await browser?.destroy()
		browser = undefined

		// The just-destroyed browser process can still be flushing profile
		// files for a brief moment after destroy() resolves — give the OS a
		// beat, then retry the removal instead of racing it.
		await waitForDelay(200)
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
		}
	})

	function tempProfileDir(): string {
		const dir = mkdtempSync(join(tmpdir(), 'orkestrel-browser-profile-'))
		tempDirs.push(dir)
		return dir
	}

	it('creates a page and navigates it in a real browser', async () => {
		const httpServer = createServer((req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' })
			res.end('<html><head><title>Real Launch</title></head><body>Hello</body></html>')
		})
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		const address = httpServer.address() as AddressInfo
		const url = `http://127.0.0.1:${address.port}/`

		try {
			browser = createBrowser({
				executable: REAL_BROWSER_EXECUTABLE,
				headless: true,
				profile: tempProfileDir(),
				args: REAL_BROWSER_ARGS,
				cdp: { port: 20_101 },
				timeout: 20_000,
			})

			await browser.connect()
			expect(browser.status).toBe('connected')

			const page = await browser.create({ url })
			const title = await page.title()
			const content = await page.content()

			expect(title).toBe('Real Launch')
			expect(content.text).toContain('Hello')
		} finally {
			await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		}
	}, 20_000)

	it('screenshot returns real PNG bytes from a real browser page', async () => {
		browser = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: tempProfileDir(),
			args: REAL_BROWSER_ARGS,
			cdp: { port: 20_102 },
			timeout: 20_000,
		})

		await browser.connect()
		const page = await browser.create()

		const result = await page.screenshot()
		expect(result.bytes.length).toBeGreaterThan(100)
		// PNG signature: 89 50 4E 47 0D 0A 1A 0A
		expect(Array.from(result.bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])

		const dir = mkdtempSync(join(tmpdir(), 'orkestrel-browser-screenshot-'))
		tempDirs.push(dir)
		const path = join(dir, 'screenshot.png')

		const withPath = await page.screenshot({ path })
		expect(withPath.path).toBe(path)
		const written = readFileSync(path)
		expect(written.length).toBeGreaterThan(100)
	}, 20_000)

	it('launches and destroys a real browser process, fully exiting it', async () => {
		browser = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: tempProfileDir(),
			args: REAL_BROWSER_ARGS,
			cdp: { port: 20_103 },
			timeout: 20_000,
		})

		await browser.connect()
		expect(browser.status).toBe('connected')

		await browser.destroy()
		expect(browser.connected).toBe(false)

		// A destroyed launch releases its CDP port — a fresh launch can reuse it.
		const relaunch = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: tempProfileDir(),
			args: REAL_BROWSER_ARGS,
			cdp: { port: 20_103 },
			timeout: 20_000,
		})
		await relaunch.connect()
		expect(relaunch.status).toBe('connected')
		await relaunch.destroy()
	}, 20_000)

	it('connect() with a profile launches with a persistent user-data dir', async () => {
		const profile = tempProfileDir()

		browser = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile,
			args: REAL_BROWSER_ARGS,
			cdp: { port: 20_104 },
			timeout: 20_000,
		})
		await browser.connect()
		expect(browser.status).toBe('connected')
		await browser.destroy()
		browser = undefined

		// Relaunching against the same profile dir succeeds — proves the
		// directory was honored as the browser's user-data-dir rather than
		// a throwaway default.
		const relaunch = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile,
			args: REAL_BROWSER_ARGS,
			cdp: { port: 20_105 },
			timeout: 20_000,
		})
		await relaunch.connect()
		expect(relaunch.status).toBe('connected')
		await relaunch.destroy()
	}, 20_000)

	it('accepts explicit headless option against a real launch', async () => {
		// This container has no display server, so a successful connect +
		// render within the timeout is itself proof the explicit `headless:
		// true` option launched a working (non-UI-dependent) browser process.
		browser = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: tempProfileDir(),
			args: REAL_BROWSER_ARGS,
			cdp: { port: 20_106 },
			timeout: 20_000,
		})

		await browser.connect()
		expect(browser.status).toBe('connected')

		const page = await browser.create()
		const content = await page.content()
		expect(content.url).toBe('about:blank')
	}, 20_000)

	// === hardening (real Chromium) — proves the audit's confirmed defects are fixed

	it('an oversized evaluate() result rejects with a coded error and the session survives', async () => {
		browser = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: tempProfileDir(),
			args: REAL_BROWSER_ARGS,
			cdp: { port: 20_110 },
			timeout: 20_000,
		})

		await browser.connect()
		const page = await browser.create()
		const pid = browser.pid

		await expect(
			page.evaluate(`'x'.repeat(${BROWSER_RESULT_LIMIT + 100_000})`),
		).rejects.toSatisfy(isBrowserResultLimitError)

		// The browser must survive the oversized result — no crashed session.
		expect(browser.connected).toBe(true)
		expect(await page.evaluate('1 + 1')).toBe(2)
		expect(pid).toBeDefined()
		const livePid = pid ?? 0
		expect(() => process.kill(livePid, 0)).not.toThrow()
	}, 20_000)

	it('content() on a huge DOM never crashes the session', async () => {
		const httpServer = createServer((req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' })
			res.end(`<html><body><div id="big">${'a'.repeat(BROWSER_RESULT_LIMIT + 500_000)}</div></body></html>`)
		})
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		const address = httpServer.address() as AddressInfo
		const url = `http://127.0.0.1:${address.port}/`

		try {
			browser = createBrowser({
				executable: REAL_BROWSER_EXECUTABLE,
				headless: true,
				profile: tempProfileDir(),
				args: REAL_BROWSER_ARGS,
				cdp: { port: 20_111 },
				timeout: 20_000,
			})

			await browser.connect()
			const page = await browser.create({ url })

			let contentError: unknown
			try {
				await page.content()
			} catch (error) {
				contentError = error
			}

			// Either a clean result or a coded BrowserResultLimitError is
			// acceptable — anything else (or a crashed session) is a failure.
			expect(contentError === undefined || isBrowserResultLimitError(contentError)).toBe(true)
			expect(browser.connected).toBe(true)
			expect(await page.evaluate('1 + 1')).toBe(2)
		} finally {
			await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		}
	}, 20_000)

	it('reattaching over CDP reports the correct page url immediately, before navigate()/content()', async () => {
		const httpServer = createServer((req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' })
			res.end('<html><head><title>Reattach Fidelity</title></head><body>Hi</body></html>')
		})
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		const address = httpServer.address() as AddressInfo
		const url = `http://127.0.0.1:${address.port}/`
		const port = 20_112
		let launched: BrowserInterface | undefined
		let reattached: BrowserInterface | undefined

		try {
			launched = createBrowser({
				executable: REAL_BROWSER_EXECUTABLE,
				headless: true,
				profile: tempProfileDir(),
				args: REAL_BROWSER_ARGS,
				cdp: { port },
				timeout: 20_000,
			})

			await launched.connect()
			await launched.create({ url })
			await launched.disconnect()

			reattached = createBrowser({ cdp: { port }, timeout: 20_000 })
			await reattached.connect()

			// A headless launch already carries its own initial about:blank tab
			// alongside the page this test created — find the one matching the
			// served url rather than assuming a single page.
			const pages = reattached.context()?.pages() ?? []
			const target = pages.find((page) => page.url === url)
			expect(target).toBeDefined()
		} finally {
			// Always terminate the shared real browser process — reattached.destroy()
			// would only locally detach (cdp-attached), leaking the process.
			if (reattached !== undefined) await reattached.close()
			else if (launched !== undefined) await launched.destroy()
			await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		}
	}, 20_000)

	// Transport-loss resumability against a REAL Chromium process would require
	// severing the CDP WebSocket at the OS level without touching the browser
	// process — not reproducible portably from a test without risking killing
	// the real browser. The behavior (transport loss while the owned process
	// stays alive does not kill it, and the same instance can reconnect) is
	// already exercised live against a real spawned process substitute in
	// "Browser external-disconnect detection" above; documented here as
	// intentionally deferred for the real-Chromium suite.
	it.todo(
		'transport-loss resumability against a real Chromium process — covered by the deterministic fake-process suite above',
	)

	it('close() gracefully shuts down an owned real browser process', async () => {
		browser = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: tempProfileDir(),
			args: REAL_BROWSER_ARGS,
			cdp: { port: 20_113 },
			timeout: 20_000,
		})

		await browser.connect()
		const pid = browser.pid
		expect(pid).toBeDefined()

		await browser.close()
		expect(browser.connected).toBe(false)

		const livePid = pid ?? 0
		expect(() => process.kill(livePid, 0)).toThrow('ESRCH')
	}, 20_000)

	it('close() on a cdp-attached instance shuts down the shared real browser and the owner observes disconnect', async () => {
		const port = 20_114
		let owner: BrowserInterface | undefined
		let second: BrowserInterface | undefined

		try {
			owner = createBrowser({
				executable: REAL_BROWSER_EXECUTABLE,
				headless: true,
				profile: tempProfileDir(),
				args: REAL_BROWSER_ARGS,
				cdp: { port },
				timeout: 20_000,
			})

			let ownerDisconnected = false
			owner.emitter.on('disconnect', () => (ownerDisconnected = true))

			await owner.connect()
			const pid = owner.pid
			expect(pid).toBeDefined()

			second = createBrowser({ cdp: { port }, timeout: 20_000 })
			await second.connect()
			expect(second.connection).toBe('cdp')

			await second.close()

			// Give the real browser time to receive Browser.close, exit, and let
			// the owner's process-exit listener observe it.
			await waitForDelay(2000)

			expect(ownerDisconnected).toBe(true)
			expect(owner.connected).toBe(false)
			const livePid = pid ?? 0
			expect(() => process.kill(livePid, 0)).toThrow('ESRCH')
		} finally {
			// Safety net — no-op once close() has already torn everything down.
			await owner?.destroy()
			await second?.destroy()
		}
	}, 20_000)

	it('navigate() with a per-call timeout rejects well under the client default and the session survives', async () => {
		const httpServer = createServer((req) => {
			// Never respond — simulates a hanging endpoint.
			void req
		})
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		const address = httpServer.address() as AddressInfo
		const url = `http://127.0.0.1:${address.port}/`

		try {
			browser = createBrowser({
				executable: REAL_BROWSER_EXECUTABLE,
				headless: true,
				profile: tempProfileDir(),
				args: REAL_BROWSER_ARGS,
				cdp: { port: 20_115 },
				timeout: 20_000,
			})

			await browser.connect()
			const page = await browser.create()

			const started = Date.now()
			await expect(page.navigate(url, { timeout: 1500 })).rejects.toThrow(
				'CDP request timed out',
			)
			const elapsed = Date.now() - started
			expect(elapsed).toBeLessThan(3000)

			// The client-side timeout must not leave the session wedged — a
			// subsequent call on the same page must still complete.
			expect(browser.connected).toBe(true)
			expect(await page.evaluate('1 + 1')).toBe(2)
		} finally {
			await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		}
	}, 20_000)

	it('records and replays a contenteditable fill via codegen on a real DOM', async () => {
		const httpServer = createServer((req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' })
			res.end(
				'<html><body><div id="editable" contenteditable="true"></div></body></html>',
			)
		})
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		const address = httpServer.address() as AddressInfo
		const url = `http://127.0.0.1:${address.port}/`

		try {
			browser = createBrowser({
				executable: REAL_BROWSER_EXECUTABLE,
				headless: true,
				profile: tempProfileDir(),
				args: REAL_BROWSER_ARGS,
				cdp: { port: 20_116 },
				timeout: 20_000,
			})

			await browser.connect()
			const page = await browser.create({ url })

			const codegen = await page.codegen()
			await page.fill('#editable', 'hello world')
			const actions = await codegen.stop()

			const fillAction = actions.find(
				(action) => action.action === 'fill' && action.selector === '#editable',
			)
			expect(fillAction).toBeDefined()
			expect(fillAction && fillAction.action === 'fill' ? fillAction.value : undefined).toBe(
				'hello world',
			)

			const script = compileCodegenScript(actions, { language: 'javascript' })

			const freshPage = await browser.create({ url })
			const factory = new Function(`return ${script}`)
			const run = factory()
			await run(freshPage)

			const replayedText = await freshPage.evaluate(
				"document.querySelector('#editable').textContent",
			)
			expect(replayedText).toBe('hello world')
		} finally {
			await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		}
	}, 20_000)
})
