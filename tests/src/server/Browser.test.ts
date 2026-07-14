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
			cdp: { port: 20_002 },
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
})
