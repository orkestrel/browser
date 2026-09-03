/**
 * Browser façade tests.
 *
 * Exercises discovery, connection, context sync, and lifecycle against an
 * in-process CDP test server (real HTTP + WebSocket sockets, no mocks — see
 * `createCDPTestServer` in `tests/setupServer.ts`). Flows that require a real
 * Chromium binary run in the `service` project, from `tests/service/browser.test.ts`,
 * which hard-requires a discovered browser rather than skipping without one.
 */

import type { BrowserContextInterface } from '@src/core'
import type { CDPTestServerInterface } from '../../setupServer.js'
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import {
	createBrowser,
	BrowserDestroyedError,
	BrowserNotConnectedError,
	BrowserConnectionError,
	isBrowserConnectionError,
	BROWSER_PROCESS_EXIT_CAUSE,
	BROWSER_TRANSPORT_LOSS_CAUSE,
	BROWSER_TRANSPORT_LOSS_DEFER_MS,
} from '@src/server'
import { createRecorder, waitForCondition, waitForDelay } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import {
	COOPERATIVE_SIGTERM,
	createCDPTestServer,
	createFakeBrowserProcess,
	createTempDirectory,
	reservePort,
	destroyFakeBrowsers,
	destroyTempDirectories,
	waitForProcessExit,
} from '../../setupServer.js'
import { ignoreCall, throwListenerError } from '../../setup.js'

// === Test scaffolding

let server: CDPTestServerInterface | undefined

afterEach(async () => {
	await server?.close()
	server = undefined
	// Safety net — SIGKILLs any fake browser process a failed/aborted test
	// left running, in addition to each test's own explicit kills.
	await destroyFakeBrowsers()
	await destroyTempDirectories()
})

// A port nothing is listening on — used for "no CDP endpoint reachable" cases.
const UNUSED_PORT = 19_991

// === idle state

describe('Browser idle state', () => {
	it('starts in idle status', () => {
		const browser = createBrowser()
		expect(browser.status).toBe('idle')
		expect(browser.status).not.toBe('connected')
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

		await waitForCondition('the idle error was reported', () => errors.count === 1)
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

	it('discover() returns an undefined endpoint when no CDP endpoint is available', async () => {
		const browser = createBrowser({ cdp: { port: UNUSED_PORT } })
		const result = await browser.discover()
		expect(result.endpoint).toBeUndefined()
		expect(result.browser).toBeUndefined()
	})

	it('discover() returns a well-shaped result', async () => {
		const browser = createBrowser({ cdp: { port: UNUSED_PORT } })
		const result = await browser.discover()
		expect(Object.keys(result).sort()).toEqual(['browser', 'endpoint'])
	})

	it('discover() finds a reachable in-process CDP endpoint', async () => {
		server = await createCDPTestServer()
		const browser = createBrowser({ cdp: { port: server.port } })
		const result = await browser.discover()
		expect(result.endpoint).toBe(server.endpoint)
		expect(result.browser).toBe('Test/1.0')
	})

	it('discover() can be called multiple times without side effects', async () => {
		const browser = createBrowser({ cdp: { port: UNUSED_PORT } })
		const r1 = await browser.discover()
		const r2 = await browser.discover()
		expect(r1.endpoint).toBeUndefined()
		expect(r2.endpoint).toBeUndefined()
	})
})

// === destroyed state

describe('Browser destroyed state', () => {
	it('destroy() from idle is idempotent', async () => {
		const browser = createBrowser()
		await browser.destroy()
		await browser.destroy()
		expect(browser.status).not.toBe('connected')
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
		expect(browser.status).not.toBe('connected')
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
		expect(result.endpoint).toBeUndefined()
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

// === connect() through CDP discovery (in-process server, no real browser)

describe('Browser connect() through CDP discovery', () => {
	it('connects over CDP when the endpoint reports no targets', async () => {
		server = await createCDPTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()

		expect(browser.status).toBe('connected')
		expect(browser.status).toBe('connected')
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
		expect(browser.status).toBe('connected')
		await browser.disconnect()
		expect(browser.status).toBe('disconnected')
		expect(browser.status).not.toBe('connected')
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

		expect(browser.status).toBe('connected')
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

		expect(browser.status).not.toBe('connected')
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

		expect(browser.status).not.toBe('connected')
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
		const start = performance.now()

		await browser.destroy()
		const error = await connecting

		expect(error).toBeInstanceOf(BrowserDestroyedError)
		expect(performance.now() - start).toBeLessThan(1000)
		expect(browser.status).not.toBe('connected')
	})

	it('can reconnect after disconnect', async () => {
		server = await createCDPTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()
		await browser.disconnect()
		expect(browser.status).not.toBe('connected')

		await browser.connect()
		expect(browser.status).toBe('connected')

		await browser.destroy()
	})

	it('disconnect() awaits the underlying socket close before resolving', async () => {
		server = await createCDPTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })

		await browser.connect()
		expect(server.sockets).toBe(1)

		await browser.disconnect()

		await waitForCondition('the test server has no open sockets', () => server?.sockets === 0, {
			budget: 500,
		})
		expect(server.sockets).toBe(0)

		await browser.connect()
		expect(browser.status).toBe('connected')

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

// === create() — page creation through the CDP test server

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
		expect(browser.status).not.toBe('connected')
		expect(browser.owned).toBe(true)
		expect(browser.pid).toBe(pid)
		expect(isRunning(pid)).toBe(true)

		await browser.connect()
		expect(browser.status).toBe('connected')
		expect(browser.connection).toBe('launch')
		expect(browser.owned).toBe(true)

		await browser.destroy()
		expect(browser.status).not.toBe('connected')

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
		const profile = createTempDirectory('orkestrel-browser-profile-').path
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
		const profileDir = createTempDirectory('orkestrel-browser-profile-').path
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
		expect(browser.status).not.toBe('connected')
		expect(browser.owned).toBe(true)

		// The process must survive disconnect() — a persistent launch is
		// released, not killed.
		expect(() => process.kill(pid, 0)).not.toThrow()

		// Reattach through CDP discovery on the same port.
		const reattached = createBrowser({ cdp: { port }, timeout: 5000 })
		await reattached.connect()
		expect(reattached.status).toBe('connected')
		expect(reattached.status).toBe('connected')
		expect(reattached.connection).toBe('cdp')

		// Destroying the reattached (CDP-discovered) session must not kill the
		// underlying process — only the original launch owns it.
		await reattached.destroy()
		expect(reattached.status).not.toBe('connected')
		expect(() => process.kill(pid, 0)).not.toThrow()

		await browser.destroy()
		await waitForProcessExit(pid)
		expect(() => process.kill(pid, 0)).toThrow('ESRCH')
	})
})

describe('Browser launcher hand-off', () => {
	it('takes over the process serving CDP when the spawned launcher exits 0 before readiness', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true, launcher: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: await reservePort() },
			timeout: 10_000,
		})

		await browser.connect()
		expect(browser.status).toBe('connected')
		expect(browser.connection).toBe('launch')

		const launcher = await fake.pid()
		const serving = await fake.browser()
		expect(serving).not.toBe(launcher)

		// The spawned process is gone, so a session that owned it would own
		// nothing; the session must own the process answering CDP instead.
		await waitForProcessExit(launcher)
		expect(isRunning(launcher)).toBe(false)
		expect(browser.pid).toBe(serving)
		expect(browser.owned).toBe(true)

		await browser.destroy()
		await waitForProcessExit(serving)
		expect(isRunning(serving)).toBe(false)
		expect(browser.pid).toBeUndefined()
	}, 20_000)

	it('rejects when the spawned process exits with a nonzero code', async () => {
		// A real spawned executable that exits 3 straight away. The script is a
		// file rather than `node -e`, so the CDP flags that follow it stay
		// script arguments instead of being parsed as Node options.
		const script = createTempDirectory('orkestrel-browser-exit-').write(
			'exit.js',
			'process.exit(3)\n',
		)
		const browser = createBrowser({
			executable: process.execPath,
			args: [script],
			cdp: { port: await reservePort() },
			timeout: 10_000,
		})

		await expect(browser.connect()).rejects.toThrow(
			'Browser process exited before CDP became ready (code: 3)',
		)
		expect(browser.status).toBe('error')
		expect(browser.pid).toBeUndefined()
	}, 20_000)

	it('rejects when a clean exit leaves no process serving CDP within the readiness budget', async () => {
		const script = createTempDirectory('orkestrel-browser-exit-').write(
			'exit.js',
			'process.exit(0)\n',
		)
		const browser = createBrowser({
			executable: process.execPath,
			args: [script],
			cdp: { port: await reservePort() },
			timeout: 1500,
		})

		await expect(browser.connect()).rejects.toThrow(BrowserConnectionError)
		expect(browser.status).toBe('error')
		expect(browser.pid).toBeUndefined()
	}, 20_000)

	it('rejects and closes the endpoint when it does not name the process serving it', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true, launcher: true, unnamed: true })
		const browser = createBrowser({
			executable: fake.executable,
			args: fake.args,
			cdp: { port: await reservePort() },
			timeout: 3000,
		})

		await expect(browser.connect()).rejects.toThrow(
			'The browser launcher exited without naming the process serving its CDP endpoint',
		)
		expect(browser.status).toBe('error')
		expect(browser.pid).toBeUndefined()

		// A browser the session cannot own is closed rather than left running.
		const serving = await fake.browser()
		await waitForProcessExit(serving)
		expect(isRunning(serving)).toBe(false)
	}, 20_000)
})

describe('Browser pid', () => {
	it('is undefined before connecting', () => {
		const browser = createBrowser()
		expect(browser.pid).toBeUndefined()
	})

	it('remains readable while a persistent owner is disconnected, then clears on destroy()', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const profileDir = createTempDirectory('orkestrel-browser-profile-').path
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
		expect(browser.status).not.toBe('connected')
		expect(browser.pid).toBe(pid)

		await expect(browser.destroy()).resolves.toBeUndefined()
		expect(browser.pid).toBeUndefined()
		expect(browser.status).not.toBe('connected')
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
		expect(browser.status).not.toBe('connected')
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
		expect(browser.status).not.toBe('connected')
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
		expect(browser.status).not.toBe('connected')
	})

	it('destroy() after disconnect is idempotent', async () => {
		server = await createCDPTestServer()
		server.list([])
		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()
		await browser.disconnect()
		await browser.destroy()
		await browser.destroy()
		expect(browser.status).not.toBe('connected')
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
		expect(browser.status).not.toBe('connected')
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

	it('wires construction-time hooks through the on option', () => {
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
			expect(browser.status).toBe('connected')
		}
		expect(disconnect.count).toBe(0)
		expect(browser.status).toBe('connected')

		await browser.destroy()
	})

	it('transport close triggers exactly one disconnect without reading the status first', async () => {
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
		await waitForCondition(
			'the browser reported one disconnect after the server closed',
			() => disconnect.count === 1,
		)

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
		expect(browser.status).not.toBe('connected')
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

		await waitForCondition('the browser released its process id', () => browser.pid === undefined)

		expect(browser.status).toBe('disconnected')
		expect(browser.pid).toBeUndefined()

		// A stranded dead #process must not block a fresh #launch with the
		// "already active" error.
		await expect(browser.connect()).resolves.toBeUndefined()
		expect(browser.status).toBe('connected')

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
		await waitForCondition(
			'the browser reported one disconnect after the socket dropped',
			() => disconnect.count === 1,
		)

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
		expect(browser.status).toBe('connected')
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
		await waitForCondition(
			'the browser reported one disconnect after the process was killed',
			() => disconnect.count === 1,
		)

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
		expect(descendant === undefined || !isRunning(descendant)).toBe(true)
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
		expect(other.status).toBe('connected')
		await other.destroy()
	})

	it('disconnect() on an attached session sends no Browser.close', async () => {
		server = await createCDPTestServer()
		server.list([])

		const browser = createBrowser({ cdp: { port: server.port } })
		await browser.connect()
		await browser.disconnect()

		expect(server.received.some((m) => m.method === 'Browser.close')).toBe(false)
		expect(browser.status).not.toBe('connected')
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
		expect(browser.status).not.toBe('connected')
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
		expect(descendant === undefined || !isRunning(descendant)).toBe(true)
		expect(browser.status).not.toBe('connected')
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
		expect(browser.status).not.toBe('connected')
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
		expect(descendant === undefined || !isRunning(descendant)).toBe(true)
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
		expect(descendant === undefined || !isRunning(descendant)).toBe(true)
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
		expect(browser.status).not.toBe('connected')
	})

	// The ignore-then-escalate path is only observable where SIGTERM is a
	// catchable signal a process can trap; see `COOPERATIVE_SIGTERM`.
	it.runIf(COOPERATIVE_SIGTERM)(
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
			expect(browser.status).not.toBe('connected')
			expect(isRunning(descendant)).toBe(false)
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
		expect(discovery.endpoint).toBe(server.endpoint)

		await browser.connect()
		expect(browser.status).toBe('connected')

		await browser.destroy()
	})
})
