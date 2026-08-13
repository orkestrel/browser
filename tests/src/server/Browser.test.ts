/**
 * Browser façade tests.
 *
 * Exercises discovery, connection, context sync, and lifecycle against an
 * in-process CDP test server (real HTTP + WebSocket sockets, no mocks — see
 * `createCDPTestServer` in `tests/setupServer.ts`). Flows that require a real
 * Chromium binary run in the `Browser real launch` suite below, gated on
 * `findSystemBrowser()` discovering an actual browser on the machine.
 */

import type { BrowserEngine, BrowserInterface } from '@src/server'
import type { BrowserContextInterface } from '@src/core'
import type { CDPTestServerInterface } from '../../setupServer.js'
import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
	createBrowser,
	findSystemBrowser,
	BrowserDestroyedError,
	BrowserNotConnectedError,
	BrowserConnectionError,
	isBrowserConnectionError,
	BROWSER_PROCESS_EXIT_CAUSE,
	BROWSER_TRANSPORT_LOSS_CAUSE,
	BROWSER_TRANSPORT_LOSS_DEFER_MS,
} from '@src/server'
import { BROWSER_RESULT_LIMIT, isBrowserResultLimitError, compileCodegenScript } from '@src/core'
import { isRecord } from '@orkestrel/contract'
import { createRecorder, requireValue, waitForDelay } from '@orkestrel/test'
import {
	createCDPTestServer,
	createBrowserProfile,
	createFakeBrowserProcess,
	createTempDirectory,
	createTCPProxy,
	reservePort,
	destroyFakeBrowsers,
	destroyTempDirectories,
	isProcessAlive,
	readServerPort,
	waitForProcessExit,
} from '../../setupServer.js'
import { ignoreCall, throwListenerError, waitForCondition } from '../../setup.js'

const REQUESTED_BROWSER_ENGINE = process.env['BROWSER_COMPATIBILITY_ENGINE']
const REAL_BROWSER_ENGINE: BrowserEngine | undefined =
	REQUESTED_BROWSER_ENGINE === 'chromium' ||
	REQUESTED_BROWSER_ENGINE === 'chrome' ||
	REQUESTED_BROWSER_ENGINE === 'edge'
		? REQUESTED_BROWSER_ENGINE
		: undefined
const REAL_BROWSER_EXECUTABLE = findSystemBrowser(
	REAL_BROWSER_ENGINE === undefined ? undefined : { engine: REAL_BROWSER_ENGINE },
)?.executable

// Container-safe launch flags: needed when running headless Chromium as root
// (the common case in CI/sandboxed containers) — sandboxing requires a
// non-root user, `/dev/shm` is often too small, and GPU access is unavailable.
const REAL_BROWSER_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']

// === Test scaffolding

let server: CDPTestServerInterface | undefined

afterEach(async () => {
	await server?.close()
	server = undefined
	// Safety net — SIGKILLs any fake browser process a failed/aborted test
	// left running, in addition to each test's own explicit kills.
	await destroyFakeBrowsers()
	destroyTempDirectories()
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
		expect(browser.owned).toBeUndefined()
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

	it('forwards listener failures to the configured emitter error handler', async () => {
		const errors = createRecorder<[unknown, string]>()
		createBrowser({
			on: {
				idle: throwListenerError,
			},
			error: errors.handler,
		})

		await waitForCondition(() => errors.count === 1)
		expect(errors.calls[0]?.[1]).toBe('idle')
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
		server = await createCDPTestServer()
		const browser = createBrowser({ cdp: { port: server.port } })
		const result = await browser.discover()
		expect(result.found).toBe(true)
		expect(result.endpoint).toBe(server.endpoint)
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
		server = await createCDPTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()

		expect(browser.status).toBe('connected')
		expect(browser.connected).toBe(true)
		expect(browser.connection).toBe('cdp')
		expect(browser.owned).toBe(false)
		expect(browser.contexts()).toHaveLength(0)

		await browser.destroy()
	})

	it('connect() is no-op when already connected', async () => {
		server = await createCDPTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()
		expect(browser.status).toBe('connected')
		await browser.connect()
		expect(browser.status).toBe('connected')

		await browser.destroy()
	})

	it('disconnect() detaches without closing the underlying connection state', async () => {
		server = await createCDPTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()
		expect(browser.connected).toBe(true)
		await browser.disconnect()
		expect(browser.status).toBe('disconnected')
		expect(browser.connected).toBe(false)
		expect(browser.connection).toBeUndefined()
		expect(browser.owned).toBeUndefined()
		await expect(browser.create()).rejects.toThrow(BrowserNotConnectedError)

		await browser.destroy()
	})

	it('shares one connection attempt across concurrent callers', async () => {
		server = await createCDPTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await Promise.all([browser.connect(), browser.connect()])

		expect(browser.connected).toBe(true)
		expect(server.sockets).toBe(1)
		await browser.destroy()
	})

	it('final disconnect waits for a reconnect queued behind disconnect', async () => {
		server = await createCDPTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()

		const first = browser.disconnect()
		const reconnecting = browser.connect()
		const final = browser.disconnect()
		await Promise.all([first, reconnecting, final])

		expect(browser.connected).toBe(false)
		expect(browser.owned).toBeUndefined()
		await browser.destroy()
	})

	it('disconnect() called during connect waits and then detaches', async () => {
		server = await createCDPTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		const connecting = browser.connect()
		const disconnecting = browser.disconnect()
		await Promise.all([connecting, disconnecting])

		expect(browser.connected).toBe(false)
		expect(browser.owned).toBeUndefined()
		await browser.destroy()
	})

	it('adopt() retains responsibility across disconnect and shuts down on destroy', async () => {
		server = await createCDPTestServer()
		server.list([])
		server.script('Browser.close', {})
		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()

		browser.adopt()
		expect(browser.owned).toBe(true)
		await browser.disconnect()
		expect(browser.owned).toBe(true)

		await browser.connect()
		expect(browser.owned).toBe(true)
		await browser.disconnect()
		await browser.destroy()

		expect(server.received.filter((message) => message.method === 'Browser.close')).toHaveLength(1)
		expect(browser.owned).toBeUndefined()
	})

	it('adopt() rejects when there is no active connection', () => {
		const browser = createBrowser()
		expect(() => browser.adopt()).toThrow(BrowserNotConnectedError)
	})

	it('destroy() cancels an in-flight connection without waiting for its full timeout', async () => {
		server = await createCDPTestServer()
		server.hang(true)
		const browser = createBrowser({ cdp: { port: server.port }, timeout: 5000 })
		const connecting = browser.connect().catch((error: unknown) => error)
		const start = Date.now()

		await browser.destroy()
		const error = await connecting

		expect(error).toBeInstanceOf(BrowserDestroyedError)
		expect(Date.now() - start).toBeLessThan(1000)
		expect(browser.connected).toBe(false)
	})

	it('can reconnect after disconnect', async () => {
		server = await createCDPTestServer()
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
		server = await createCDPTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()
		expect(server.sockets).toBe(1)

		await browser.disconnect()

		await waitForCondition(() => server?.sockets === 0, 500)
		expect(server.sockets).toBe(0)

		await browser.connect()
		expect(browser.connected).toBe(true)

		await browser.destroy()
	})
})

// === syncContexts — existing targets attached on connect

describe('Browser syncContexts()', () => {
	it('syncs an existing page target into a context on connect', async () => {
		server = await createCDPTestServer()
		server.list([{ id: 'target-1', type: 'page', title: 'Existing', url: 'about:blank' }])
		server.script('Target.attachToTarget', { sessionId: 'session-1' })
		server.script('Page.enable', {})
		server.script('Runtime.enable', {})
		server.script('Target.detachFromTarget', {})

		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()

		expect(browser.contexts()).toHaveLength(1)
		expect(browser.context()).toBeDefined()
		expect(browser.context()?.pages()).toHaveLength(1)

		await browser.destroy()
	})

	it('syncs targets through an explicit endpoint without relying on separate host/port options', async () => {
		server = await createCDPTestServer()
		server.list([
			{
				id: 'endpoint-target',
				type: 'page',
				title: 'Endpoint',
				url: 'https://example.com/endpoint',
			},
		])
		server.script('Target.attachToTarget', { sessionId: 'endpoint-session' })
		server.script('Page.enable', {})
		server.script('Runtime.enable', {})
		server.script('Target.detachFromTarget', {})

		const browser = createBrowser({ cdp: { endpoint: server.endpoint } })
		await browser.connect()

		expect(browser.context()?.page()?.url).toBe('https://example.com/endpoint')

		await browser.destroy()
	})

	it('ignores non-page targets when syncing', async () => {
		server = await createCDPTestServer()
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
		server = await createCDPTestServer()
		server.list([])
		server.script('Target.createTarget', { targetId: 'new-target' })
		server.script('Target.attachToTarget', { sessionId: 'session-2' })
		server.script('Page.enable', {})
		server.script('Runtime.enable', {})
		server.script('Target.detachFromTarget', {})
		server.script('Target.closeTarget', {})

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
		server = await createCDPTestServer()
		server.list([])
		server.script('Target.createTarget', { targetId: 'new-target' })
		server.script('Target.attachToTarget', { sessionId: 'session-3' })
		server.script('Page.enable', {})
		server.script('Runtime.enable', {})
		server.script('Emulation.setDeviceMetricsOverride', {})
		server.script('Target.detachFromTarget', {})
		server.script('Target.closeTarget', {})

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

describe('Browser isolate()', () => {
	it('creates and emits a configured incognito CDP context', async () => {
		server = await createCDPTestServer()
		server.list([])
		server.script('Target.createBrowserContext', { browserContextId: 'context-1' })
		server.script('Browser.setDownloadBehavior', {})
		server.script('Target.disposeBrowserContext', {})
		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()
		const contexts = createRecorder<[context: BrowserContextInterface]>()
		browser.emitter.on('context', contexts.handler)

		const context = await browser.isolate({
			proxy: { server: 'http://proxy.test:8080', bypass: ['localhost', '*.internal'] },
			origins: ['https://trusted.test'],
			downloads: { path: 'C:\\downloads', named: true },
			emulation: { locale: 'en-GB', viewport: { width: 900, height: 700 } },
		})

		expect(context.id).toBe('context-1')
		expect(browser.contexts()).toContain(context)
		expect(contexts.calls).toEqual([[context]])
		expect(
			server.received.find((message) => message.method === 'Target.createBrowserContext')?.params,
		).toEqual({
			disposeOnDetach: false,
			proxyServer: 'http://proxy.test:8080',
			proxyBypassList: 'localhost,*.internal',
			originsWithUniversalNetworkAccess: ['https://trusted.test'],
		})
		expect(
			server.received.find((message) => message.method === 'Browser.setDownloadBehavior')?.params,
		).toEqual({
			behavior: 'allowAndName',
			browserContextId: 'context-1',
			downloadPath: 'C:\\downloads',
			eventsEnabled: true,
		})

		await context.close()
		expect(browser.contexts()).not.toContain(context)
		await browser.destroy()
	})

	it('rejects isolation while disconnected', async () => {
		const browser = createBrowser()

		await expect(browser.isolate()).rejects.toThrow(BrowserNotConnectedError)
	})

	it('rejects malformed context configuration before creating remote state', async () => {
		server = await createCDPTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()

		await expect(browser.isolate({ proxy: { server: '' } })).rejects.toThrow(
			'proxy server cannot be empty',
		)
		await expect(browser.isolate({ origins: ['ftp://example.com'] })).rejects.toThrow(
			'absolute HTTP(S) origin',
		)

		expect(
			server.received.some((message) => message.method === 'Target.createBrowserContext'),
		).toBe(false)
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

	it('disconnects and reconnects an ephemeral launch while retaining process ownership', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: await reservePort() },
			timeout: 5000,
		})

		await browser.connect()
		expect(browser.status).toBe('connected')
		expect(browser.connection).toBe('launch')

		const pid = await fake.pid()

		await browser.disconnect()
		expect(browser.connected).toBe(false)
		expect(browser.owned).toBe(true)
		expect(browser.pid).toBe(pid)
		expect(isProcessAlive(pid)).toBe(true)

		await browser.connect()
		expect(browser.connected).toBe(true)
		expect(browser.connection).toBe('launch')
		expect(browser.owned).toBe(true)

		await browser.destroy()
		expect(browser.connected).toBe(false)

		expect(() => process.kill(pid, 0)).toThrow('ESRCH')
	})

	it('launches with an isolated user-data directory and removes it after teardown', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: await reservePort() },
			timeout: 5000,
		})

		await browser.connect()
		const profileArgument = (await fake.arguments()).find((argument) =>
			argument.startsWith('--user-data-dir='),
		)
		if (profileArgument === undefined) throw new Error('Missing browser profile argument')
		const path = profileArgument.slice('--user-data-dir='.length)
		expect(path).toContain('orkestrel-browser-')
		expect(existsSync(path)).toBe(true)
		expect(browser.connection).toBe('launch')

		await browser.destroy()
		expect(existsSync(path)).toBe(false)
	})

	it('never removes a caller-owned persistent user-data directory', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const profile = createBrowserProfile()
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			profile,
			cdp: { port: await reservePort() },
			timeout: 5000,
		})

		await browser.connect()
		expect(await fake.arguments()).toContain(`--user-data-dir=${profile}`)
		await browser.destroy()

		expect(existsSync(profile)).toBe(true)
	})

	it('connect() with a requested engine and no matching installed browser rejects with the engine in context', async () => {
		const browser = createBrowser({
			cdp: { port: UNUSED_PORT },
			engine: 'edge',
			// Forces empty discovery deterministically — on a machine with a real
			// Edge install, unconstrained discovery would find it and launch it
			// instead of rejecting.
			browsers: { env: {}, paths: [], names: [], stores: [] },
			timeout: 2000,
		})

		await expect(browser.connect()).rejects.toThrow(BrowserConnectionError)
		await expect(browser.connect()).rejects.toMatchObject({ context: { engine: 'edge' } })
	})

	it('disconnect() on a persistent (profile-backed) launch releases the process without killing it, allowing reattachment', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const profileDir = createBrowserProfile()
		const port = await reservePort()

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
		expect(browser.owned).toBe(true)

		const pid = await fake.pid()

		await expect(browser.disconnect()).resolves.toBeUndefined()
		expect(browser.connected).toBe(false)
		expect(browser.owned).toBe(true)

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

		await browser.destroy()
		await waitForProcessExit(pid)
		expect(() => process.kill(pid, 0)).toThrow('ESRCH')
	})
})

describe('Browser pid', () => {
	it('is undefined before connecting', () => {
		const browser = createBrowser()
		expect(browser.pid).toBeUndefined()
	})

	it('remains readable while a persistent owner is disconnected, then clears on destroy()', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const profileDir = createBrowserProfile()
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			profile: profileDir,
			cdp: { port: await reservePort() },
			timeout: 5000,
		})

		await browser.connect()
		const pid = await fake.pid()
		expect(browser.pid).toBe(pid)

		await browser.disconnect()
		expect(browser.connected).toBe(false)
		expect(browser.pid).toBe(pid)

		await expect(browser.destroy()).resolves.toBeUndefined()
		expect(browser.pid).toBeUndefined()
		expect(browser.connected).toBe(false)
	})

	it('is undefined for a CDP-attached connection', async () => {
		server = await createCDPTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()
		expect(browser.pid).toBeUndefined()

		await browser.destroy()
	})

	it('returns the launched process pid', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: await reservePort() },
			timeout: 5000,
		})

		await browser.connect()
		const pid = await fake.pid()
		expect(browser.pid).toBe(pid)

		await expect(browser.destroy()).resolves.toBeUndefined()
		expect(browser.pid).toBeUndefined()
		expect(browser.connected).toBe(false)
	})

	it('is undefined after destroy()', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: await reservePort() },
			timeout: 5000,
		})

		await browser.connect()
		await expect(browser.destroy()).resolves.toBeUndefined()
		expect(browser.pid).toBeUndefined()
		expect(browser.connected).toBe(false)
	})
})

// === destroy ordering

describe('Browser destroy() ordering', () => {
	it('emits destroy once and destroys the emitter last', async () => {
		server = await createCDPTestServer()
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
		server = await createCDPTestServer()
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
		const browser = createBrowser({ on: { discover: ignoreCall } })
		expect(browser.emitter.count('discover')).toBe(1)
	})

	it('emits idle event after construction', async () => {
		const idle = createRecorder<[]>()
		createBrowser({ on: { idle: idle.handler } })
		await new Promise((resolve) => queueMicrotask(() => resolve(undefined)))
		expect(idle.count).toBe(1)
	})

	it('emits idle event on disconnect', async () => {
		server = await createCDPTestServer()
		server.list([])
		const idle = createRecorder<[]>()
		const browser = createBrowser({ cdp: { port: server.port }, on: { idle: idle.handler } })
		await new Promise((resolve) => queueMicrotask(() => resolve(undefined)))
		const initialCount = idle.count

		await browser.connect()
		await browser.disconnect()

		expect(idle.count).toBeGreaterThan(initialCount)
		await browser.destroy()
	})

	it('emits discover event', async () => {
		const discovered = createRecorder<[]>()
		const browser = createBrowser({
			cdp: { port: UNUSED_PORT },
			on: { discover: discovered.handler },
		})
		await browser.discover()
		expect(discovered.count).toBe(1)
	})

	it('emits destroy event on destroy()', async () => {
		const destroyed = createRecorder<[]>()
		const browser = createBrowser({ on: { destroy: destroyed.handler } })
		await browser.destroy()
		expect(destroyed.count).toBe(1)
	})

	it('supports runtime on/off subscription', () => {
		const browser = createBrowser()
		const handler = ignoreCall
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
		server = await createCDPTestServer()
		server.list([])
		const disconnect = createRecorder<[]>()
		const browser = createBrowser({
			cdp: { port: server.port },
			on: { disconnect: disconnect.handler },
		})
		await browser.connect()

		for (let i = 0; i < 20; i++) {
			expect(browser.connected).toBe(true)
		}
		expect(disconnect.count).toBe(0)
		expect(browser.status).toBe('connected')

		await browser.destroy()
	})

	it('transport close triggers exactly one disconnect without reading .connected', async () => {
		const testServer = await createCDPTestServer()
		server = testServer
		testServer.list([])
		const disconnect = createRecorder<[]>()
		const browser = createBrowser({
			cdp: { port: testServer.port },
			on: { disconnect: disconnect.handler },
		})
		await browser.connect()

		await testServer.close()
		server = undefined
		await waitForCondition(() => disconnect.count === 1)

		expect(disconnect.count).toBe(1)
		expect(browser.status).toBe('disconnected')
		// An external transport loss must never send a remote Browser.close —
		// close() shuts down the shared remote ONLY on an explicit user call.
		expect(testServer.received.some((m) => m.method === 'Browser.close')).toBe(false)

		await browser.destroy()
	})

	it('does not emit a spurious error/disconnect when destroy() runs during the transport-loss defer window', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const errors = createRecorder<[]>()
		const disconnect = createRecorder<[]>()
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: await reservePort() },
			timeout: 5000,
			on: {
				error: errors.handler,
				disconnect: disconnect.handler,
			},
		})

		await browser.connect()

		// Drop the transport (process stays alive) then IMMEDIATELY destroy —
		// destroy() sets #destroyed synchronously, so the deferred transport-loss
		// handler (or an in-flight immediate one) must become a no-op instead of
		// emitting its own error/disconnect on top of destroy()'s teardown.
		await fake.dropSocket()
		await browser.destroy()

		// Wait past the transport-loss defer window so any stray deferred
		// handler gets a chance to fire (and would be caught here if it did).
		await waitForDelay(BROWSER_TRANSPORT_LOSS_DEFER_MS + 100)

		expect(errors.count).toBe(0)
		expect(disconnect.count).toBe(0)
		expect(browser.connected).toBe(false)
	})

	it('cleans up and permits reconnecting on the same instance when the process is already dead by the time a transport-loss defer resolves', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: await reservePort() },
			timeout: 5000,
		})

		await browser.connect()
		const pid = await fake.pid()

		// Drop the transport, then kill the process outright — regardless of
		// whether Node's own 'exit' event races ahead of the transport-loss
		// defer, the end state must be a fully cleared #process (no stranded
		// dead process) so the SAME instance can relaunch.
		await fake.dropSocket()
		process.kill(pid, 'SIGKILL')

		await waitForCondition(() => browser.pid === undefined)

		expect(browser.status).toBe('disconnected')
		expect(browser.pid).toBeUndefined()

		// A stranded dead #process must not block a fresh #launch with the
		// "already active" error.
		await expect(browser.connect()).resolves.toBeUndefined()
		expect(browser.connected).toBe(true)

		await browser.destroy()
	})

	it('transport loss while the owned process stays alive does not kill it, and the same instance reattaches', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const disconnect = createRecorder<[]>()
		const errors = createRecorder<[error: unknown]>()
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: await reservePort() },
			timeout: 5000,
			on: {
				disconnect: disconnect.handler,
				error: errors.handler,
			},
		})

		await browser.connect()
		expect(browser.connection).toBe('launch')
		const pid = await fake.pid()

		await fake.dropSocket()
		await waitForCondition(() => disconnect.count === 1)

		expect(disconnect.count).toBe(1)
		expect(browser.status).toBe('disconnected')
		const lastError = errors.calls[0]?.[0]
		expect(lastError).toBeInstanceOf(BrowserConnectionError)
		if (!isBrowserConnectionError(lastError)) {
			throw new Error('Expected a BrowserConnectionError')
		}
		expect(lastError.context?.['cause']).toBe(BROWSER_TRANSPORT_LOSS_CAUSE)
		expect(() => process.kill(pid, 0)).not.toThrow()

		await browser.connect()
		expect(browser.connected).toBe(true)
		expect(browser.connection).toBe('launch')

		await browser.destroy()
		expect(() => process.kill(pid, 0)).toThrow('ESRCH')
	})

	it('an observed process exit drains descendants, coded error then disconnect', async () => {
		const fake = createFakeBrowserProcess({
			serveCDP: true,
			descendant: process.platform !== 'win32',
		})
		const disconnect = createRecorder<[]>()
		const errors = createRecorder<[error: unknown]>()
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: await reservePort() },
			timeout: 5000,
			on: {
				disconnect: disconnect.handler,
				error: errors.handler,
			},
		})

		await browser.connect()
		const pid = await fake.pid()
		expect(browser.pid).toBe(pid)
		const descendant = process.platform === 'win32' ? undefined : await fake.descendant()

		process.kill(pid, 'SIGKILL')
		await waitForCondition(() => disconnect.count === 1)

		expect(disconnect.count).toBe(1)
		expect(browser.status).toBe('disconnected')
		const lastError = errors.calls[0]?.[0]
		expect(lastError).toBeInstanceOf(BrowserConnectionError)
		if (!isBrowserConnectionError(lastError)) {
			throw new Error('Expected a BrowserConnectionError')
		}
		expect(lastError.context?.['cause']).toBe(BROWSER_PROCESS_EXIT_CAUSE)
		expect(browser.pid).toBeUndefined()

		await expect(browser.destroy()).resolves.toBeUndefined()
		expect(browser.pid).toBeUndefined()
		expect(descendant === undefined || !isProcessAlive(descendant)).toBe(true)
	})
})

// === destroy()/close() lifecycle matrix (design-2, design-3)

describe('Browser destroy()/close() matrix', () => {
	it('destroy() on a CDP-attached browser sends no Target.closeTarget, and the server stays usable', async () => {
		server = await createCDPTestServer()
		server.list([{ id: 'target-1', type: 'page', title: 'Existing', url: 'about:blank' }])
		server.script('Target.attachToTarget', { sessionId: 'session-1' })
		server.script('Page.enable', {})
		server.script('Runtime.enable', {})
		server.script('Target.detachFromTarget', {})

		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()
		expect(browser.contexts()).toHaveLength(1)

		await browser.destroy()

		const closeTargetCalls = server.received.filter((m) => m.method === 'Target.closeTarget')
		expect(closeTargetCalls).toHaveLength(0)
		// destroy() must NEVER send a remote Browser.close — it is a local
		// detach/teardown only; Browser.close is sent EXCLUSIVELY by close().
		expect(server.received.some((m) => m.method === 'Browser.close')).toBe(false)

		// The server (standing in for "another client's shared browser") stays usable.
		const other = createBrowser({ cdp: { port: server.port } })
		await other.connect()
		expect(other.connected).toBe(true)
		await other.destroy()
	})

	it('disconnect() on an attached session sends no Browser.close', async () => {
		server = await createCDPTestServer()
		server.list([])

		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()
		await browser.disconnect()

		expect(server.received.some((m) => m.method === 'Browser.close')).toBe(false)
		expect(browser.connected).toBe(false)
	})

	it('close() on an attached session sends Browser.close and cleans up locally', async () => {
		server = await createCDPTestServer()
		server.list([])
		server.script('Browser.close', {})

		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()

		await browser.close()

		const closeCalls = server.received.filter((m) => m.method === 'Browser.close')
		expect(closeCalls).toHaveLength(1)
		expect(browser.connected).toBe(false)
		await expect(browser.connect()).rejects.toThrow(BrowserDestroyedError)
	})

	it('close() on an owned session results in the process exiting', async () => {
		const fake = createFakeBrowserProcess({
			serveCDP: true,
			descendant: process.platform !== 'win32',
		})
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: await reservePort() },
			timeout: 5000,
		})

		await browser.connect()
		const pid = await fake.pid()
		const descendant = process.platform === 'win32' ? undefined : await fake.descendant()
		expect(browser.pid).toBe(pid)

		await expect(browser.close()).resolves.toBeUndefined()

		expect(browser.pid).toBeUndefined()
		expect(descendant === undefined || !isProcessAlive(descendant)).toBe(true)
		expect(browser.connected).toBe(false)
	}, 10_000)
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
		server = await createCDPTestServer()
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
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: await reservePort(), discover: false },
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
		const fake = createFakeBrowserProcess({ descendant: process.platform !== 'win32' })
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
		expect(browser.pid).toBe(pid)
		const descendant = process.platform === 'win32' ? undefined : await fake.descendant()
		controller.abort()

		await expect(connectPromise).rejects.toThrow(BrowserConnectionError)

		expect(browser.pid).toBeUndefined()
		expect(descendant === undefined || !isProcessAlive(descendant)).toBe(true)
	})
})

// === post-spawn connect failure (lifecycle-1) kills the spawned process

describe('Browser post-spawn connect failure', () => {
	it('kills the spawned process when CDP never becomes ready', async () => {
		const fake = createFakeBrowserProcess({ descendant: process.platform !== 'win32' })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: 19_999 },
			timeout: 2000,
		})

		const connectPromise = browser.connect()
		const failure = connectPromise.catch((error: unknown) => error)
		const pid = await fake.pid()
		expect(browser.pid).toBe(pid)
		const descendant = process.platform === 'win32' ? undefined : await fake.descendant()

		expect(isBrowserConnectionError(await failure)).toBe(true)

		expect(browser.pid).toBeUndefined()
		expect(descendant === undefined || !isProcessAlive(descendant)).toBe(true)
	})
})

// === destroy() kill escalation (lifecycle-6)

describe('Browser destroy() kill escalation', () => {
	it('destroy() fully terminates a cooperative launched process', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: await reservePort() },
			timeout: 5000,
		})

		await browser.connect()
		expect(browser.status).toBe('connected')

		const pid = await fake.pid()
		expect(browser.pid).toBe(pid)

		await expect(browser.destroy()).resolves.toBeUndefined()

		expect(browser.pid).toBeUndefined()
		expect(browser.connected).toBe(false)
	})

	// Windows cannot trap SIGTERM (Node delivers it as an unconditional
	// terminate, not a catchable signal), so the ignore-then-escalate path
	// is only observable on POSIX platforms.
	it.runIf(process.platform !== 'win32')(
		'escalates the full process group to SIGKILL before destroy resolves',
		async () => {
			const fake = createFakeBrowserProcess({
				serveCDP: true,
				ignoreSIGTERM: true,
				descendant: true,
			})
			const browser = createBrowser({
				executable: fake.executable,
				args: fake.args,
				cdp: { port: await reservePort() },
				timeout: 5000,
			})

			await browser.connect()
			expect(browser.status).toBe('connected')

			const pid = await fake.pid()
			const descendant = await fake.descendant()
			expect(browser.pid).toBe(pid)

			await expect(browser.destroy()).resolves.toBeUndefined()

			expect(browser.pid).toBeUndefined()
			expect(browser.connected).toBe(false)
			expect(isProcessAlive(descendant)).toBe(false)
		},
		15_000,
	)
})

// === host option (robustness-7)

describe('Browser host option', () => {
	it('honors an explicit host for discovery and connection', async () => {
		server = await createCDPTestServer()
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

	afterEach(async () => {
		await browser?.destroy()
		browser = undefined
	})

	it('creates a page and navigates it in a real browser', async () => {
		const httpServer = createServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' })
			res.end('<html><head><title>Real Launch</title></head><body>Hello</body></html>')
		})
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		const url = `http://127.0.0.1:${readServerPort(httpServer)}/`

		try {
			browser = createBrowser({
				executable: requireValue(REAL_BROWSER_EXECUTABLE),
				headless: true,
				profile: createBrowserProfile(),
				args: REAL_BROWSER_ARGS,
				cdp: { port: await reservePort() },
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

	it('drives locators, frames, routes, snapshots, accessibility, and PDF in a real browser', async () => {
		const httpServer = createServer((request, response) => {
			if (request.url === '/frame') {
				response.writeHead(200, { 'content-type': 'text/html' })
				response.end('<html><body><label>Email <input name="email"></label></body></html>')
				return
			}
			response.writeHead(200, { 'content-type': 'text/html' })
			response.end(
				'<html><body><button aria-label="Save" onclick="document.body.dataset.clicked=\'yes\'">Save</button><iframe name="checkout" src="/frame"></iframe></body></html>',
			)
		})
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		const url = `http://127.0.0.1:${readServerPort(httpServer)}/`

		try {
			browser = createBrowser({
				executable: requireValue(REAL_BROWSER_EXECUTABLE),
				headless: true,
				profile: createBrowserProfile(),
				args: REAL_BROWSER_ARGS,
				cdp: { port: await reservePort() },
				timeout: 20_000,
			})
			await browser.connect()
			const page = await browser.create({ url })

			const save = page.selectors.role('button', { name: 'Save', exact: true })
			expect(await save.count()).toBe(1)
			await save.click()
			expect(await page.evaluate('document.body.dataset.clicked')).toBe('yes')

			const frame = await page.frame('checkout')
			expect(frame).toBeDefined()
			if (frame === undefined) throw new Error('Named frame was not attached')
			const email = frame.selectors.label('Email', { exact: true })
			await email.fill('ada@example.com')
			expect(await email.value()).toBe('ada@example.com')

			await page.network.route({ url: '**/api', method: 'GET' }, async (route) => {
				await route.fulfill({
					status: 200,
					headers: { 'content-type': 'application/json' },
					body: '{"source":"route"}',
				})
			})
			expect(await page.evaluate("fetch('/api').then((response) => response.json())")).toEqual({
				source: 'route',
			})

			const snapshot = await page.snapshot()
			expect(snapshot.documents.length).toBeGreaterThanOrEqual(2)
			const accessibility = await page.accessibility.snapshot()
			expect(accessibility.nodes.some((node) => node.name === 'Save')).toBe(true)
			const pdf = await page.pdf()
			expect(Array.from(pdf.bytes.subarray(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46])
		} finally {
			await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		}
	}, 30_000)

	it('screenshot returns real PNG bytes from a real browser page', async () => {
		browser = createBrowser({
			executable: requireValue(REAL_BROWSER_EXECUTABLE),
			headless: true,
			profile: createBrowserProfile(),
			args: REAL_BROWSER_ARGS,
			cdp: { port: await reservePort() },
			timeout: 20_000,
		})

		await browser.connect()
		const page = await browser.create()

		const result = await page.screenshot()
		expect(result.bytes.length).toBeGreaterThan(100)
		// PNG signature: 89 50 4E 47 0D 0A 1A 0A
		expect(Array.from(result.bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])

		const dir = createTempDirectory('orkestrel-browser-screenshot-')
		const path = join(dir, 'screenshot.png')

		const withPath = await page.screenshot({ path })
		expect(withPath.path).toBe(path)
		const written = readFileSync(path)
		expect(written.length).toBeGreaterThan(100)
	}, 20_000)

	it('launches and destroys a real browser process, fully exiting it', async () => {
		const port = await reservePort()
		browser = createBrowser({
			executable: requireValue(REAL_BROWSER_EXECUTABLE),
			headless: true,
			profile: createBrowserProfile(),
			args: REAL_BROWSER_ARGS,
			cdp: { port },
			timeout: 20_000,
		})

		await browser.connect()
		expect(browser.status).toBe('connected')

		await browser.destroy()
		expect(browser.connected).toBe(false)

		// A destroyed launch releases its CDP port — a fresh launch can reuse it.
		const relaunch = createBrowser({
			executable: requireValue(REAL_BROWSER_EXECUTABLE),
			headless: true,
			profile: createBrowserProfile(),
			args: REAL_BROWSER_ARGS,
			cdp: { port },
			timeout: 20_000,
		})
		await relaunch.connect()
		expect(relaunch.status).toBe('connected')
		await relaunch.destroy()
	}, 20_000)

	it('connect() with a profile launches with a persistent user-data dir', async () => {
		const profile = createBrowserProfile()

		browser = createBrowser({
			executable: requireValue(REAL_BROWSER_EXECUTABLE),
			headless: true,
			profile,
			args: REAL_BROWSER_ARGS,
			cdp: { port: await reservePort() },
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
			executable: requireValue(REAL_BROWSER_EXECUTABLE),
			headless: true,
			profile,
			args: REAL_BROWSER_ARGS,
			cdp: { port: await reservePort() },
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
			executable: requireValue(REAL_BROWSER_EXECUTABLE),
			headless: true,
			profile: createBrowserProfile(),
			args: REAL_BROWSER_ARGS,
			cdp: { port: await reservePort() },
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
			executable: requireValue(REAL_BROWSER_EXECUTABLE),
			headless: true,
			profile: createBrowserProfile(),
			args: REAL_BROWSER_ARGS,
			cdp: { port: await reservePort() },
			timeout: 20_000,
		})

		await browser.connect()
		const page = await browser.create()
		const pid = browser.pid

		await expect(page.evaluate(`'x'.repeat(${BROWSER_RESULT_LIMIT + 100_000})`)).rejects.toSatisfy(
			isBrowserResultLimitError,
		)

		// The browser must survive the oversized result — no crashed session.
		expect(browser.connected).toBe(true)
		expect(await page.evaluate('1 + 1')).toBe(2)
		expect(pid).toBeDefined()
		const livePid = requireValue(pid)
		expect(() => process.kill(livePid, 0)).not.toThrow()
	}, 20_000)

	it('content() on a huge DOM never crashes the session', async () => {
		const httpServer = createServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' })
			res.end(
				`<html><body><div id="big">${'a'.repeat(BROWSER_RESULT_LIMIT + 500_000)}</div></body></html>`,
			)
		})
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		const url = `http://127.0.0.1:${readServerPort(httpServer)}/`

		try {
			browser = createBrowser({
				executable: requireValue(REAL_BROWSER_EXECUTABLE),
				headless: true,
				profile: createBrowserProfile(),
				args: REAL_BROWSER_ARGS,
				cdp: { port: await reservePort() },
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
		const httpServer = createServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' })
			res.end('<html><head><title>Reattach Fidelity</title></head><body>Hi</body></html>')
		})
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		const url = `http://127.0.0.1:${readServerPort(httpServer)}/`
		const port = await reservePort()
		let launched: BrowserInterface | undefined
		let reattached: BrowserInterface | undefined

		try {
			launched = createBrowser({
				executable: requireValue(REAL_BROWSER_EXECUTABLE),
				headless: true,
				profile: createBrowserProfile(),
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
			if (reattached !== undefined) {
				await reattached.destroy()
			}
			// The launching instance retains process ownership across its
			// persistent disconnect, so it also owns orderly termination and
			// waits until Chromium has released the profile directory.
			await launched?.destroy()
			await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		}
	}, 40_000)

	it('transport-loss resumability against a real Chromium process, proxied over a raw TCP pipe', async () => {
		const cdpPort = await reservePort()
		const proxyPort = await reservePort()

		// A real Chromium rejects a CDP WebSocket upgrade whose Host header
		// doesn't match an allowed origin — since the raw TCP proxy forwards
		// the client's Host header (127.0.0.1:proxyPort) unmodified to
		// Chromium (which is listening as 127.0.0.1:cdpPort), Chromium must be
		// told to allow it explicitly.
		const owner = createBrowser({
			executable: requireValue(REAL_BROWSER_EXECUTABLE),
			headless: true,
			profile: createBrowserProfile(),
			args: [...REAL_BROWSER_ARGS, '--remote-allow-origins=*'],
			cdp: { port: cdpPort },
			timeout: 20_000,
		})

		let proxied: BrowserInterface | undefined
		const proxy = createTCPProxy(proxyPort)

		try {
			await owner.connect()
			expect(owner.status).toBe('connected')
			const ownerPid = owner.pid
			expect(ownerPid).toBeDefined()

			const versionResponse = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
			const versionJson: unknown = await versionResponse.json()
			const webSocketDebuggerUrl =
				isRecord(versionJson) && typeof versionJson['webSocketDebuggerUrl'] === 'string'
					? versionJson['webSocketDebuggerUrl']
					: undefined
			expect(webSocketDebuggerUrl).toBeDefined()
			if (webSocketDebuggerUrl === undefined) {
				throw new Error('Chromium did not report a WebSocket debugger URL')
			}
			const chromiumWSURL = new URL(webSocketDebuggerUrl)

			await proxy.start(chromiumWSURL.hostname, Number(chromiumWSURL.port))
			const proxiedEndpoint = `ws://127.0.0.1:${proxyPort}${chromiumWSURL.pathname}`

			const errors = createRecorder<[]>()
			const disconnect = createRecorder<[]>()
			proxied = createBrowser({
				cdp: { endpoint: proxiedEndpoint },
				timeout: 5000,
				on: {
					error: errors.handler,
					disconnect: disconnect.handler,
				},
			})

			await proxied.connect()
			expect(proxied.connected).toBe(true)
			expect(proxied.connection).toBe('cdp')
			const page = await proxied.create()
			expect(await page.evaluate('1 + 1')).toBe(2)

			// Sever the transport: destroy every piped socket and close the
			// proxy server — the browser process itself is untouched.
			await proxy.stop()
			await waitForCondition(() => errors.count === 1 && disconnect.count === 1)

			expect(errors.count).toBe(1)
			expect(disconnect.count).toBe(1)
			expect(proxied.connected).toBe(false)

			// Chromium (owned by `owner`) survives the transport loss.
			const livePid = requireValue(ownerPid)
			expect(() => process.kill(livePid, 0)).not.toThrow()

			// Rebuild the proxy on the SAME port so the proxied instance's
			// frozen `cdp.endpoint` (still pointing at 127.0.0.1:proxyPort)
			// resolves again — connect() on the same instance resumes.
			await proxy.start(chromiumWSURL.hostname, Number(chromiumWSURL.port))

			await proxied.connect()
			expect(proxied.connected).toBe(true)
			const resumedPage = await proxied.create()
			expect(await resumedPage.evaluate('2 + 2')).toBe(4)
		} finally {
			await proxied?.destroy()
			await proxy.stop()
			await owner.destroy()
		}
	}, 20_000)

	it('close() gracefully shuts down an owned real browser process', async () => {
		browser = createBrowser({
			executable: requireValue(REAL_BROWSER_EXECUTABLE),
			headless: true,
			profile: createBrowserProfile(),
			args: REAL_BROWSER_ARGS,
			cdp: { port: await reservePort() },
			timeout: 20_000,
		})

		await browser.connect()
		const pid = browser.pid
		expect(pid).toBeDefined()

		await browser.close()
		expect(browser.connected).toBe(false)

		const livePid = requireValue(pid)
		expect(() => process.kill(livePid, 0)).toThrow('ESRCH')
	}, 20_000)

	it('close() on a cdp-attached instance shuts down the shared real browser and the owner observes disconnect', async () => {
		const port = await reservePort()
		let owner: BrowserInterface | undefined
		let second: BrowserInterface | undefined

		try {
			owner = createBrowser({
				executable: requireValue(REAL_BROWSER_EXECUTABLE),
				headless: true,
				profile: createBrowserProfile(),
				args: REAL_BROWSER_ARGS,
				cdp: { port },
				timeout: 20_000,
			})
			const disconnect = createRecorder<[]>()
			owner.emitter.on('disconnect', disconnect.handler)

			await owner.connect()
			const pid = owner.pid
			expect(pid).toBeDefined()

			second = createBrowser({ cdp: { port }, timeout: 20_000 })
			await second.connect()
			expect(second.connection).toBe('cdp')

			await second.close()

			// Attached close() does not await the remote process. Observe the owner's
			// actual lifecycle and the OS process rather than sleeping for a fixed delay.
			await waitForCondition(() => disconnect.count > 0, 20_000, 50)
			expect(owner.connected).toBe(false)
			const livePid = requireValue(pid)
			await waitForProcessExit(livePid)
			expect(disconnect.count).toBe(1)
			expect(isProcessAlive(livePid)).toBe(false)
		} finally {
			// Safety net — no-op once close() has already torn everything down.
			await owner?.destroy()
			await second?.destroy()
		}
	}, 40_000)

	it('navigate() with a per-call timeout rejects well under the client default and the session survives', async () => {
		const httpServer = createServer((req) => {
			// Never respond — simulates a hanging endpoint.
			void req
		})
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		const url = `http://127.0.0.1:${readServerPort(httpServer)}/`

		try {
			browser = createBrowser({
				executable: requireValue(REAL_BROWSER_EXECUTABLE),
				headless: true,
				profile: createBrowserProfile(),
				args: REAL_BROWSER_ARGS,
				cdp: { port: await reservePort() },
				timeout: 20_000,
			})

			await browser.connect()
			const page = await browser.create()

			const started = Date.now()
			await expect(page.navigate(url, { timeout: 1500 })).rejects.toThrow('CDP request timed out')
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
		const httpServer = createServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' })
			res.end('<html><body><div id="editable" contenteditable="true"></div></body></html>')
		})
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		const url = `http://127.0.0.1:${readServerPort(httpServer)}/`

		try {
			browser = createBrowser({
				executable: requireValue(REAL_BROWSER_EXECUTABLE),
				headless: true,
				profile: createBrowserProfile(),
				args: REAL_BROWSER_ARGS,
				cdp: { port: await reservePort() },
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
