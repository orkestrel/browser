/**
 * Proof for `tests/setupServer.ts`.
 *
 * The subject is the Node-only test infrastructure `tests/src/server/**` and `tests/service/**`
 * drive: the loop-clock reader and its aligner, the port reservation helpers, the process wait,
 * the scratch registry, the browse child's first call and ending, the Chromium process table
 * reader and its teardown, the raw TCP fixtures, the in-process CDP server and the frames of each
 * socket write it performs, the spawned fake browser, the fixture page and module server, the
 * built-bundle precondition of the document page, the stage that imports a generated journey
 * module through a link to this package, the FIFO a lock read parks on, the exited process
 * identifier, and the bundle import reader. Every case uses the real resource the fixture exists
 * to provide — real host timers, real loopback sockets on ephemeral ports, real files, and real
 * child processes.
 *
 * `tests/setupServer.ts` declares no DOM-driving export, so this file defers nothing to a browser
 * suite. This package registers no browser project.
 *
 * Expected values are derived by a route the module does not share: `performance.now()` timing the
 * loop clock's readings, a second socket connecting to the port `readServerPort` reports, the
 * platform `WebSocket` client driving the CDP fixture, the child's own `spawn` handle carrying the
 * identifier the fixture publishes, `existsSync` reading the directories the scratch registry
 * removes, Node's own module resolution for the entries the document page's import map names, and
 * `realpathSync` reading the stage's link.
 */

import type { CDPTestServerInterface } from './setupServer.js'
import { createAttachedPage } from './setup.js'
import { afterAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { readFile, rmdir } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeWebSocketFrame, WEBSOCKET_OPCODE_TEXT } from '@orkestrel/websocket'
import {
	createRecorder,
	readProperty,
	requireValue,
	retryUntil,
	waitForCondition,
	waitForEvent,
} from '@orkestrel/test'
import { createScratch, isRunning } from '@orkestrel/test/server'
import {
	alignLoopClock,
	BrowseChild,
	BrowserLauncher,
	BrowseLog,
	createBrowseFixture,
	BrowserLockObserver,
	observeBrowserFilesystem,
	COOPERATIVE_SIGTERM,
	PROCESS_TABLE,
	createBrowserJourneyStage,
	createCDPTestServer,
	createFakeBrowserProcess,
	createFifo,
	createFixtureServer,
	createStallServer,
	createTCPProxy,
	createTempDirectory,
	destroyChromiumProcesses,
	destroyFakeBrowsers,
	destroyTempDirectories,
	endBrowseChild,
	FIFO_PATHS,
	FIXTURE_CHECKOUT_CODE,
	FIXTURE_CHECKOUT_DELAY,
	FIXTURE_DOCUMENT_BUNDLE,
	FIXTURE_DOCUMENT_IMPORTS,
	FIXTURE_LATE_DELAY,
	FIXTURE_LATE_TEXT,
	FIXTURE_REGISTRY_MODULE,
	loadFixtureModule,
	openFifoWriter,
	readBundleImports,
	readChromiumProcesses,
	readExitedProcessId,
	readFixtureProcessId,
	readLoopClock,
	readProfiles,
	readServerPort,
	readWebSocketFrames,
	renderFixturePage,
	requireDocumentBundle,
	reservePort,
	StallServer,
	startBrowseChild,
	waitForProcessExit,
} from './setupServer.js'

const WORKSPACE = fileURLToPath(new URL('../', import.meta.url))

describe('BrowserLauncher eager U2', () => {
	it('retains isolated contexts and reports kill synchronously and drop later', async () => {
		const launcher = new BrowserLauncher()
		const first = launcher.launch({})
		const second = launcher.launch({})
		try {
			await first.connect()
			const context = await first.isolate()
			expect(first.contexts()).toEqual([context])
			expect(first.context()).toBe(context)
			const killed = createRecorder<readonly []>()
			first.emitter.on('disconnect', killed.handler)
			requireValue(launcher.browsers[0], 'first double').kill()
			expect(killed.count).toBe(1)
			await expect(first.ping()).rejects.toMatchObject({ code: 'BROWSER_NOT_CONNECTED_ERROR' })
			await second.connect()
			const dropped = createRecorder<readonly []>()
			second.emitter.on('disconnect', dropped.handler)
			requireValue(launcher.browsers[1], 'second double').drop()
			expect(dropped.count).toBe(0)
			await expect(second.ping()).rejects.toMatchObject({ code: 'BROWSER_NOT_CONNECTED_ERROR' })
			await waitForCondition('deferred disconnect', () => dropped.count === 1)
		} finally {
			await Promise.all(launcher.browsers.map((browser) => browser.destroy()))
		}
	})

	it('defers teardown and limits isolation and survivor refusals to the requested doubles', async () => {
		const launcher = new BrowserLauncher({ broken: 1, survivors: 1 })
		const first = launcher.launch({})
		const second = launcher.launch({})
		try {
			await first.connect()
			await expect(first.isolate()).rejects.toThrow('refused isolation')
			const double = requireValue(launcher.browsers[0], 'first double')
			double.defer()
			const ending = double.destroy()
			expect(double.destroyed).toBe(false)
			double.resume()
			await expect(ending).rejects.toThrow('termination is unconfirmed')
			await second.connect()
			await expect(second.isolate()).resolves.toBeDefined()
			await second.destroy()
		} finally {
			for (const browser of launcher.browsers) {
				browser.resume()
				await browser.destroy().catch(() => undefined)
			}
		}
	})
	it('holds from an index and refuses only the requested launch count', async () => {
		const launcher = new BrowserLauncher()
		launcher.hold(1)
		launcher.refuse(1, 1)
		const first = launcher.launch({})
		const refused = launcher.launch({})
		const later = launcher.launch({})
		try {
			await first.connect()
			const pending = refused.connect()
			expect(launcher.browsers[0]?.fixture).toBeDefined()
			expect(launcher.browsers[1]?.fixture).toBeUndefined()
			launcher.release()
			await expect(pending).rejects.toThrow('The fixture refused the launch')
			await later.connect()
			expect(launcher.browsers[2]?.fixture).toBeDefined()
		} finally {
			launcher.release()
			await Promise.all(launcher.browsers.map((browser) => browser.destroy()))
		}
	})
	it('collects diagnostic chunks and owns the browse fixture teardown', async () => {
		const log = new BrowseLog()
		log.write('first\n')
		log.write('second\n')
		expect(log.lines).toEqual(['first\n', 'second\n'])
		log.destroy()
		const fixture = createBrowseFixture()
		try {
			await fixture.server.start()
			expect(fixture.launcher.browsers).toHaveLength(1)
			await fixture.teardown.destroy()
			expect(existsSync(fixture.scratch.path)).toBe(false)
			expect(fixture.pair.input.destroyed).toBe(true)
			expect(fixture.pair.output.destroyed).toBe(true)
		} finally {
			await fixture.teardown.destroy()
		}
	})
	it('aborts a held connect with the supplied reason', async () => {
		const launcher = new BrowserLauncher()
		launcher.hold()
		const controller = new AbortController()
		const browser = launcher.launch({ signal: controller.signal })
		const connecting = browser.connect()
		const reason = new Error('held connect aborted')
		controller.abort(reason)
		await expect(connecting).rejects.toBe(reason)
		expect(browser.endpoint).toBeUndefined()
		await browser.destroy()
	})

	it('counts each double version from one and exposes its connected endpoint', async () => {
		const calls = createRecorder<[number]>()
		const launcher = new BrowserLauncher({ version: calls.handler })
		const browser = launcher.launch({})
		const second = launcher.launch({})
		try {
			expect(browser.endpoint).toBeUndefined()
			await expect(browser.ping()).rejects.toMatchObject({ code: 'BROWSER_NOT_CONNECTED_ERROR' })
			await browser.connect()
			expect(browser.endpoint).toMatch(/^ws:\/\/127\.0\.0\.1\/devtools\/browser\//)
			await browser.ping()
			await browser.ping()
			await second.connect()
			await second.ping()
			expect(calls.calls).toEqual([[1], [2], [1]])
			await browser.disconnect()
			expect(browser.endpoint).toBeUndefined()
			await expect(browser.ping()).rejects.toMatchObject({ code: 'BROWSER_NOT_CONNECTED_ERROR' })
		} finally {
			await browser.destroy()
			await second.destroy()
		}
		await expect(browser.ping()).rejects.toMatchObject({ code: 'BROWSER_DESTROYED_ERROR' })
	})

	it('bounds silent pings and propagates version failures and aborts', async () => {
		const launcher = new BrowserLauncher({
			silent: 1,
			timeout: 20,
			version: () => {
				throw new Error('version refused')
			},
		})
		const silent = launcher.launch({})
		const refusing = launcher.launch({})
		try {
			await silent.connect()
			await expect(silent.ping()).rejects.toMatchObject({ code: 'BROWSER_CDP_TIMEOUT_ERROR' })
			const controller = new AbortController()
			const pending = silent.ping({ signal: controller.signal })
			const reason = new Error('ping aborted')
			controller.abort(reason)
			await expect(pending).rejects.toBe(reason)
			await refusing.connect()
			await expect(refusing.ping()).rejects.toThrow('version refused')
		} finally {
			await silent.destroy()
			await refusing.destroy()
		}
	})
})

afterAll(async () => {
	await destroyFakeBrowsers()
	await destroyTempDirectories()
})

// === Loop clock

describe('readLoopClock', () => {
	it('advances in whole milliseconds by the time performance.now() measures between readings', () => {
		const opened = performance.now()
		const before = readLoopClock()
		const inner = performance.now()
		alignLoopClock(5)
		const outer = performance.now()
		const after = readLoopClock()
		const closed = performance.now()
		expect(Number.isInteger(before)).toBe(true)
		expect(Number.isInteger(after)).toBe(true)
		// Each reading truncates by under 1 ms and a coarse clock trails by under 1 ms more.
		expect(after - before).toBeGreaterThan(outer - inner - 2)
		expect(after - before).toBeLessThan(closed - opened + 2)
	})
})

describe('alignLoopClock', () => {
	it('returns after the loop clock ticks and the offset elapses on performance.now()', () => {
		const before = readLoopClock()
		const opened = performance.now()
		alignLoopClock(0.5)
		const closed = performance.now()
		expect(readLoopClock()).toBeGreaterThan(before)
		expect(closed - opened).toBeGreaterThanOrEqual(0.5)
	})
})

// === Ports

describe('BrowserLockObserver', () => {
	it('observes completed filesystem checks and preserves presence and refusals', async () => {
		const scratch = createScratch()
		try {
			const observed = createRecorder<[string, string | undefined]>()
			const files = new BrowserLockObserver({ root: scratch.path }, async (path) => {
				observed.handler(path, scratch.read('entry'))
				scratch.write('entry', 'observed')
			})
			const entry = join(scratch.path, 'entry')
			await expect(files.check(entry)).resolves.toBe(false)
			await expect(files.check(entry)).resolves.toBe(true)
			expect(observed.calls).toEqual([
				[entry, undefined],
				[entry, 'observed'],
			])
			await expect(files.check(join(scratch.path, '..', 'escape'))).rejects.toThrow('Refused path')
			expect(observed.count).toBe(2)
			const controller = new AbortController()
			controller.abort(new Error('aborted check'))
			await expect(files.check(entry, { signal: controller.signal })).rejects.toThrow(
				'aborted check',
			)
			expect(observed.count).toBe(2)
		} finally {
			scratch.destroy()
		}
	})
})

describe('observeBrowserFilesystem', () => {
	it('interleaves after a real filesystem failure and before its promise resumes only once', async () => {
		const scratch = createScratch()
		const observed = createRecorder<[]>()
		const path = join(scratch.path, 'replacement')
		const hook = observeBrowserFilesystem(() => {
			mkdirSync(path)
			observed.handler()
		})
		try {
			await expect(rmdir(path)).rejects.toMatchObject({ code: 'ENOENT' })
			expect(lstatSync(path).isDirectory()).toBe(true)
			await rmdir(path)
			expect(observed.count).toBe(1)
		} finally {
			hook.disable()
			scratch.destroy()
		}
	})
})

describe('reservePort', () => {
	it('reserves a loopback port that a server can then bind and read back', async () => {
		const port = await reservePort()
		expect(Number.isInteger(port)).toBe(true)
		expect(port).toBeGreaterThan(0)

		const server = createServer()
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject)
			server.listen(port, '127.0.0.1', resolve)
		})

		expect(readServerPort(server)).toBe(port)
		await new Promise<void>((resolve) => server.close(() => resolve()))
	})
})

describe('readServerPort', () => {
	it('reports the port a second connection reaches and refuses a server that never bound', async () => {
		const server = createServer()
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject)
			server.listen(0, '127.0.0.1', resolve)
		})
		const port = readServerPort(server)

		const client = createConnection({ host: '127.0.0.1', port })
		await new Promise<void>((resolve, reject) => {
			client.once('error', reject)
			client.once('connect', () => resolve())
		})
		client.destroy()
		await new Promise<void>((resolve) => server.close(() => resolve()))

		expect(() => readServerPort(createServer())).toThrow('Test server did not bind a TCP port')
	})
})

// === Processes and scratch directories

describe('waitForProcessExit', () => {
	it('resolves after a spawned process exits and refuses a live process within its budget', async () => {
		const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
		const pid = requireValue(child.pid, 'The spawned probe reported no process identifier')

		await expect(waitForProcessExit(pid, 5000)).resolves.toBeUndefined()
		expect(isRunning(pid)).toBe(false)

		await expect(waitForProcessExit(process.pid, 200)).rejects.toThrow(
			`Condition "process ${process.pid} has exited" did not hold within 200ms`,
		)
	})
})

describe('startBrowseChild', () => {
	it('refuses a first look that answers an error, and the child exits 0 at the end of its input', async () => {
		const scratch = createTempDirectory()
		const child = new BrowseChild(join(WORKSPACE, 'dist/bin/main.js'), scratch.path, {
			BROWSE_EXECUTABLE: join(scratch.path, 'missing/chrome'),
		})
		try {
			await expect(startBrowseChild(child)).rejects.toThrow(/^the first look answered .*ENOENT/u)
			endBrowseChild(child, 'EOF')
			expect(await child.ending).toStrictEqual({ code: 0, signal: null })
		} finally {
			await child.destroy()
		}
	})
})

describe('readProfiles', () => {
	it('lists nothing for an absent directory and every entry by path in name order', () => {
		const scratch = createTempDirectory()
		const profiles = join(scratch.path, '.profiles')
		expect(readProfiles(profiles)).toStrictEqual([])
		mkdirSync(join(profiles, 'teapot'), { recursive: true })
		mkdirSync(join(profiles, 'kettle'))
		expect(readProfiles(profiles)).toStrictEqual([
			join(profiles, 'kettle'),
			join(profiles, 'teapot'),
		])
	})
})

// A host that names no FIFO at a path is the one `FIFO_PATHS` reports false for.
describe('createFifo', () => {
	it.runIf(FIFO_PATHS)(
		'creates a FIFO the host reports as one, and openFifoWriter waits for a reader, then ends its read',
		async () => {
			const scratch = createTempDirectory()
			const fifo = join(scratch.path, 'journey.lock')
			createFifo(fifo)
			expect(lstatSync(fifo).isFIFO()).toBe(true)
			expect(() => createFifo(fifo)).toThrow(`mkfifo refused ${fifo}`)
			await expect(openFifoWriter(fifo, { budget: 50 })).rejects.toThrow(
				`Retry "a reader opens the FIFO at ${fifo}" did not succeed within 50ms`,
			)
			const read = readFile(fifo, 'utf8')
			const writer = await openFifoWriter(fifo, { budget: 5000 })
			try {
				await writer.writeFile('4417')
			} finally {
				await writer.close()
			}
			expect(await read).toBe('4417')
		},
	)
})

describe('readExitedProcessId', () => {
	it('returns the identifier of a process the host no longer runs', () => {
		const pid = readExitedProcessId()
		expect(Number.isSafeInteger(pid)).toBe(true)
		expect(pid).not.toBe(process.pid)
		expect(() => process.kill(pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
	})
})

describe('readBundleImports', () => {
	it('reads the names one specifier gives a bundle and the ones the bundle declares again', () => {
		const bundle = [
			'import { BrowserError, BrowserContext as Context, isBrowserError } from "../core/index.js";',
			"import { isRecord } from '@orkestrel/contract';",
			'var BrowserError$1 = class extends Error {};',
			'function isBrowserErrorLike(value) { return value instanceof BrowserError$1 }',
			'const BrowserErrorCode = "BROWSER_JOURNEY_FILE";',
			'class isRecord {}',
		].join('\n')
		expect(readBundleImports(bundle, '../core/index.js')).toStrictEqual({
			imported: ['BrowserError', 'BrowserContext', 'isBrowserError'],
			redeclared: ['BrowserError'],
		})
		expect(readBundleImports(bundle, '@orkestrel/contract')).toStrictEqual({
			imported: ['isRecord'],
			redeclared: ['isRecord'],
		})
		expect(readBundleImports(bundle, '../browser/index.js')).toStrictEqual({
			imported: [],
			redeclared: [],
		})
		expect(
			readBundleImports('import { BrowserError } from "../core/index.js";', '../core/index.js'),
		).toStrictEqual({ imported: ['BrowserError'], redeclared: [] })
	})
})

// The processes are Node children carrying Chromium's switches as arguments, so the table reads
// the same command-line shape a browser and its renderer leave, with a control outside the
// directory that neither the listing nor the teardown may reach.
describe('readChromiumProcesses', () => {
	it.runIf(PROCESS_TABLE)(
		'lists the processes whose profile sits in a directory, and destroyChromiumProcesses ends only those',
		async () => {
			const scratch = createTempDirectory()
			const profiles = join(realpathSync(scratch.path), '.profiles')
			const kettle = join(profiles, 'kettle')
			const idle = 'setInterval(() => {}, 1000)'
			const browser = spawn(process.execPath, ['-e', idle, '--', `--user-data-dir=${kettle}`], {
				stdio: 'ignore',
			})
			const renderer = spawn(
				process.execPath,
				['-e', idle, '--', '--type=renderer', `--user-data-dir=${kettle}`],
				{ stdio: 'ignore' },
			)
			const outside = spawn(
				process.execPath,
				['-e', idle, '--', `--user-data-dir=${join(scratch.path, 'elsewhere', 'kettle')}`],
				{ stdio: 'ignore' },
			)
			const pids = [browser, renderer, outside].map((child) =>
				requireValue(child.pid, 'a spawned process reported no identifier'),
			)
			try {
				await waitForCondition(
					'both processes in the directory are listed',
					() => readChromiumProcesses(profiles).length === 2,
					{ budget: 5000, interval: 10 },
				)
				expect(readChromiumProcesses(profiles)).toHaveLength(2)
				expect(readChromiumProcesses(profiles)).toStrictEqual(
					expect.arrayContaining([
						{ pid: pids[0], profile: kettle, browser: true },
						{ pid: pids[1], profile: kettle, browser: false },
					]),
				)
				await destroyChromiumProcesses(profiles)
				await waitForProcessExit(requireValue(pids[0], 'no browser process'))
				await waitForProcessExit(requireValue(pids[1], 'no renderer process'))
				expect(isRunning(requireValue(pids[2], 'no control process'))).toBe(true)
				expect(readChromiumProcesses(profiles)).toStrictEqual([])
			} finally {
				for (const child of [browser, renderer, outside]) child.kill('SIGKILL')
			}
		},
	)
})

describe('createTempDirectory', () => {
	it('allocates a prefixed scratch directory and removes every registered directory on teardown', async () => {
		const first = createTempDirectory()
		const second = createTempDirectory('orkestrel-browser-proof-')
		first.write('note.txt', 'hello')

		expect(basename(first.path).startsWith('orkestrel-browser-test-')).toBe(true)
		expect(basename(second.path).startsWith('orkestrel-browser-proof-')).toBe(true)
		expect(existsSync(join(first.path, 'note.txt'))).toBe(true)

		await destroyTempDirectories()

		expect([existsSync(first.path), existsSync(second.path)]).toStrictEqual([false, false])
	})
})

// === Raw TCP fixtures

describe('createStallServer', () => {
	it('names a loopback CDP endpoint only after it starts', async () => {
		expect(() => new StallServer().endpoint).toThrow('Stall server has not started')

		const server = await createStallServer()
		expect(server.endpoint).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/cdp$/)
		await server.close()
	})

	it('accepts a connection, answers nothing, and severs it on close', async () => {
		const server = await createStallServer()
		const port = Number(new URL(server.endpoint).port)
		const received: string[] = []

		const client = createConnection({ host: '127.0.0.1', port })
		client.on('data', (chunk) => received.push(chunk.toString('utf8')))
		await new Promise<void>((resolve, reject) => {
			client.once('error', reject)
			client.once('connect', () => resolve())
		})
		client.write('GET /cdp HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n\r\n')

		const severed = new Promise<void>((resolve) => client.once('close', () => resolve()))
		await server.close()
		await severed

		expect(received).toStrictEqual([])
	})
})

describe('createTCPProxy', () => {
	it('forwards bytes to the upstream server, refuses a second start, and severs its clients on stop', async () => {
		const upstream = createServer((socket) => socket.pipe(socket))
		await new Promise<void>((resolve, reject) => {
			upstream.once('error', reject)
			upstream.listen(0, '127.0.0.1', resolve)
		})
		const proxyPort = await reservePort()
		const proxy = createTCPProxy(proxyPort)
		await proxy.start('127.0.0.1', readServerPort(upstream))

		await expect(proxy.start('127.0.0.1', readServerPort(upstream))).rejects.toThrow(
			'TCP proxy is already started',
		)

		const client = createConnection({ host: '127.0.0.1', port: proxyPort })
		const echoed = await new Promise<string>((resolve, reject) => {
			client.once('error', reject)
			client.once('data', (chunk) => resolve(chunk.toString('utf8')))
			client.once('connect', () => client.write('ping'))
		})
		expect(echoed).toBe('ping')

		const severed = new Promise<void>((resolve) => client.once('close', () => resolve()))
		await proxy.stop()
		await severed
		await new Promise<void>((resolve) => upstream.close(() => resolve()))
	})
})

// === In-process CDP test server

describe('createCDPTestServer', () => {
	it('serves the debugger URL, the listed targets, and a 404 for an unknown path', async () => {
		const server = await createCDPTestServer()
		server.list([{ id: 'target-1', type: 'page', title: 'Test Page', url: 'about:blank' }])

		const versionResponse = await fetch(`${server.url}/json/version`)
		const version: unknown = await versionResponse.json()
		expect(readProperty<string>(version, 'webSocketDebuggerUrl')).toBe(
			`ws://127.0.0.1:${server.port}/cdp`,
		)

		const listResponse = await fetch(`${server.url}/json/list`)
		const listed: unknown = await listResponse.json()
		expect(listed).toStrictEqual([
			{ id: 'target-1', type: 'page', title: 'Test Page', url: 'about:blank' },
		])

		const unknownResponse = await fetch(`${server.url}/json/other`)
		expect(unknownResponse.status).toBe(404)
		await unknownResponse.text()

		await server.close()
	})

	it('never answers the version endpoint while hanging and answers again once it stops', async () => {
		const server = await createCDPTestServer()
		server.hang(true)

		await expect(
			fetch(`${server.url}/json/version`, { signal: AbortSignal.timeout(250) }),
		).rejects.toThrow('The operation was aborted due to timeout')

		server.hang(false)
		const response = await fetch(`${server.url}/json/version`)
		expect(response.status).toBe(200)
		await response.text()

		await server.close()
	})

	it('records every request frame and answers a scripted method with its value or its handler', async () => {
		const server = await createCDPTestServer()
		server.script('Browser.getVersion', { product: 'Test/1.0' })
		server.script('Page.navigate', (params: Readonly<Record<string, unknown>>) => ({
			frameId: params['url'],
		}))
		const frames: unknown[] = []

		const client = new WebSocket(server.endpoint)
		client.addEventListener('message', (event) => frames.push(JSON.parse(String(event.data))))
		await new Promise<void>((resolve, reject) => {
			client.addEventListener('open', () => resolve(), { once: true })
			client.addEventListener(
				'error',
				() => reject(new Error('The CDP test server refused the upgrade')),
				{ once: true },
			)
		})

		client.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }))
		client.send(
			JSON.stringify({ id: 2, method: 'Page.navigate', params: { url: 'https://example.com/' } }),
		)
		await waitForCondition(
			'the CDP test server answered every request',
			() => frames.length === 2,
			{
				budget: 2000,
			},
		)

		expect(frames).toStrictEqual([
			{ id: 1, result: { product: 'Test/1.0' } },
			{ id: 2, result: { frameId: 'https://example.com/' } },
		])
		expect(server.received).toStrictEqual([
			{ id: 1, method: 'Browser.getVersion', params: undefined },
			{ id: 2, method: 'Page.navigate', params: { url: 'https://example.com/' } },
		])

		await server.close()
	})

	it('answers Target.getTargets from the listed targets when no script overrides it', async () => {
		const server = await createCDPTestServer()
		server.list([{ id: 'target-1', type: 'page', title: 'Test Page', url: 'about:blank' }])
		const frames: unknown[] = []

		const client = new WebSocket(server.endpoint)
		client.addEventListener('message', (event) => frames.push(JSON.parse(String(event.data))))
		await new Promise<void>((resolve, reject) => {
			client.addEventListener('open', () => resolve(), { once: true })
			client.addEventListener(
				'error',
				() => reject(new Error('The CDP test server refused the upgrade')),
				{ once: true },
			)
		})

		client.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }))
		await waitForCondition(
			'the CDP test server answered the target query',
			() => frames.length === 1,
			{
				budget: 2000,
			},
		)

		expect(frames).toStrictEqual([
			{
				id: 1,
				result: {
					targetInfos: [
						{ targetId: 'target-1', type: 'page', title: 'Test Page', url: 'about:blank' },
					],
				},
			},
		])

		await server.close()
	})

	it('leaves an unscripted request unanswered until a reply, a failure, or an event is pushed', async () => {
		const server = await createCDPTestServer()
		const frames: unknown[] = []

		const client = new WebSocket(server.endpoint)
		client.addEventListener('message', (event) => frames.push(JSON.parse(String(event.data))))
		await new Promise<void>((resolve, reject) => {
			client.addEventListener('open', () => resolve(), { once: true })
			client.addEventListener(
				'error',
				() => reject(new Error('The CDP test server refused the upgrade')),
				{ once: true },
			)
		})

		client.send(JSON.stringify({ id: 5, method: 'Storage.clearDataForOrigin' }))
		await waitForCondition(
			'the CDP test server recorded the unscripted request',
			() => server.received.length === 1,
			{ budget: 2000 },
		)
		expect(frames).toStrictEqual([])

		server.reply(requireValue(server.received[0]).id, { done: true })
		server.fail(6, 'nope')
		server.event('Page.loadEventFired', { timestamp: 1 }, 'session-1')
		await waitForCondition('the CDP test server pushed every frame', () => frames.length === 3, {
			budget: 2000,
		})

		expect(frames).toStrictEqual([
			{ id: 5, result: { done: true } },
			{ id: 6, error: { message: 'nope' } },
			{ method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId: 'session-1' },
		])

		await server.close()
	})

	it('writes the invokeTool reply and the toolResponded event in one socket write, and every other frame in its own', async () => {
		const server = await createCDPTestServer()
		try {
			const tools = [{ name: 'search', description: 'Search', frameId: 'main' }]
			server.advertise(tools, { status: 'Completed', output: { found: 'book' } })
			const frames: unknown[] = []

			const client = new WebSocket(server.endpoint)
			client.addEventListener('message', (event) => frames.push(JSON.parse(String(event.data))))
			await new Promise<void>((resolve, reject) => {
				client.addEventListener('open', () => resolve(), { once: true })
				client.addEventListener(
					'error',
					() => reject(new Error('The CDP test server refused the upgrade')),
					{ once: true },
				)
			})

			client.send(JSON.stringify({ id: 1, method: 'WebMCP.enable', sessionId: 'session-1' }))
			client.send(
				JSON.stringify({
					id: 2,
					method: 'WebMCP.invokeTool',
					params: { frameId: 'main', toolName: 'search', input: { query: 'book' } },
					sessionId: 'session-1',
				}),
			)
			await waitForCondition(
				'the CDP test server answered both requests',
				() => frames.length === 4,
				{
					budget: 2000,
				},
			)

			const reply = { id: 2, result: { invocationId: 'invocation-2' } }
			const responded = {
				method: 'WebMCP.toolResponded',
				params: { status: 'Completed', output: { found: 'book' }, invocationId: 'invocation-2' },
				sessionId: 'session-1',
			}
			expect(
				server.writes.map((chunk) =>
					readWebSocketFrames(chunk).map((payload): unknown => JSON.parse(payload)),
				),
			).toStrictEqual([
				[{ id: 1, result: {} }],
				[{ method: 'WebMCP.toolsAdded', params: { tools }, sessionId: 'session-1' }],
				[reply, responded],
			])
			expect(frames).toStrictEqual([
				{ id: 1, result: {} },
				{ method: 'WebMCP.toolsAdded', params: { tools }, sessionId: 'session-1' },
				reply,
				responded,
			])
		} finally {
			await server.close()
		}
	})

	it('counts the open sockets and closes each one', async () => {
		const server: CDPTestServerInterface = await createCDPTestServer()
		expect(server.sockets).toBe(0)

		const client = new WebSocket(server.endpoint)
		await new Promise<void>((resolve, reject) => {
			client.addEventListener('open', () => resolve(), { once: true })
			client.addEventListener(
				'error',
				() => reject(new Error('The CDP test server refused the upgrade')),
				{ once: true },
			)
		})
		await waitForCondition('the CDP test server accepted the socket', () => server.sockets === 1, {
			budget: 2000,
		})

		const severed = new Promise<void>((resolve) =>
			client.addEventListener('close', () => resolve(), { once: true }),
		)
		await server.close()
		await severed

		expect(server.sockets).toBe(0)
	})
})

// === Fake browser process

describe('readWebSocketFrames', () => {
	it('reads each frame one write carries, in order, and nothing from an empty write', () => {
		const chunk = Buffer.concat([
			encodeWebSocketFrame(WEBSOCKET_OPCODE_TEXT, '{"id":1}'),
			encodeWebSocketFrame(WEBSOCKET_OPCODE_TEXT, 'x'.repeat(300)),
		])

		expect(readWebSocketFrames(chunk)).toStrictEqual(['{"id":1}', 'x'.repeat(300)])
		expect(readWebSocketFrames(Buffer.alloc(0))).toStrictEqual([])
	})

	it('refuses a write that ends inside a frame, naming the frame offset', () => {
		const first = encodeWebSocketFrame(WEBSOCKET_OPCODE_TEXT, 'whole')
		const second = encodeWebSocketFrame(WEBSOCKET_OPCODE_TEXT, 'cut short')

		expect(() =>
			readWebSocketFrames(Buffer.concat([first, second.subarray(0, second.length - 1)])),
		).toThrow(
			`The write ends inside the frame at byte ${first.length} of ${first.length + second.length - 1}`,
		)
	})
})

describe('readFixtureProcessId', () => {
	it('reads a published identifier and refuses a torn write or a file that never appears', async () => {
		const scratch = createTempDirectory('orkestrel-browser-pid-')
		scratch.write('pid.txt', '4321\n')
		scratch.write('torn.txt', '')

		await expect(readFixtureProcessId(scratch, 'pid.txt')).resolves.toBe(4321)
		await expect(readFixtureProcessId(scratch, 'torn.txt')).rejects.toThrow(
			join(scratch.path, 'torn.txt'),
		)
		await expect(readFixtureProcessId(scratch, 'absent.txt')).rejects.toThrow(
			join(scratch.path, 'absent.txt'),
		)
	})
})

describe('createFakeBrowserProcess', () => {
	it('closes inherited stderr without announcing readiness after re-execution', async () => {
		const fake = createFakeBrowserProcess({ launcher: true, mute: true })
		const child = spawn(fake.executable, fake.args, { stdio: ['ignore', 'ignore', 'pipe'] })
		const chunks: string[] = []
		const stderr = requireValue(child.stderr)
		stderr.setEncoding('utf8')
		stderr.on('data', (chunk) => chunks.push(String(chunk)))
		await once(stderr, 'close', { signal: AbortSignal.timeout(2000) })
		expect(chunks).toEqual([])
		expect(child.exitCode).toBe(0)
	})
	it('registers SIGTERM before publishing the browser pid', () => {
		const fake = createFakeBrowserProcess({ ignoreSIGTERM: true })
		const script = readFileSync(requireValue(fake.args[0]), 'utf8')
		const handler = script.indexOf("process.on('SIGTERM', () => {})")

		expect(handler).toBeGreaterThanOrEqual(0)
		expect(script.indexOf("require('fs').writeFileSync(")).toBeGreaterThan(handler)
	})

	it('registers SIGTERM before the launcher or relaunched browser publishes its pid', () => {
		const fake = createFakeBrowserProcess({ launcher: true, ignoreSIGTERM: true })
		const script = readFileSync(requireValue(fake.args[0]), 'utf8')
		const handler = script.indexOf("process.on('SIGTERM', () => {})")

		expect(handler).toBeGreaterThanOrEqual(0)
		expect(script.indexOf("if (process.argv.includes('--orkestrel-relaunched'))")).toBeGreaterThan(
			handler,
		)
		expect(script.indexOf("require('fs').writeFileSync(")).toBeGreaterThan(handler)
	})

	it('registers SIGTERM before the descendant publishes its pid', () => {
		const fake = createFakeBrowserProcess({ descendant: true, ignoreSIGTERM: true })
		const script = readFileSync(requireValue(fake.args[0]), 'utf8')

		expect(script).toContain(
			`['-e', "process.on('SIGTERM', () => {})\\nrequire('fs').writeFileSync(`,
		)
	})

	it('publishes the identifier and the argument vector of the process it is spawned as', async () => {
		const fake = createFakeBrowserProcess()
		const flag = '--remote-debugging-port=0'
		const child = spawn(fake.executable, [...fake.args, flag], { stdio: 'ignore' })

		const pid = await fake.pid()
		expect(pid).toBe(child.pid)
		expect(await fake.arguments()).toStrictEqual([fake.executable, ...fake.args, flag])

		child.kill('SIGKILL')
		await waitForProcessExit(pid)
	})

	it('serves discovery on the requested debugging port and severs the socket while staying alive', async () => {
		const fake = createFakeBrowserProcess({ serveCDP: true })
		const port = await reservePort()
		const child = spawn(fake.executable, [...fake.args, `--remote-debugging-port=${port}`], {
			stdio: 'ignore',
		})
		const pid = await fake.pid()

		const version = await retryUntil(
			'the fake browser discovery endpoint',
			async () =>
				fetch(`http://127.0.0.1:${port}/json/version`)
					.then((response) => response.json())
					.catch(() => undefined),
			(value) => value !== undefined,
			{ attempts: 100, interval: 20, budget: 5000 },
		)
		expect(readProperty<string>(version, 'webSocketDebuggerUrl')).toBe(`ws://127.0.0.1:${port}/cdp`)

		const client = new WebSocket(`ws://127.0.0.1:${port}/cdp`)
		await new Promise<void>((resolve, reject) => {
			client.addEventListener('open', () => resolve(), { once: true })
			client.addEventListener(
				'error',
				() => reject(new Error('The fake browser refused the upgrade')),
				{ once: true },
			)
		})
		const severed = new Promise<void>((resolve) =>
			client.addEventListener('close', () => resolve(), { once: true }),
		)
		await fake.dropSocket()
		await severed

		expect(isRunning(pid)).toBe(true)

		child.kill('SIGKILL')
		await waitForProcessExit(pid)
	})

	it.runIf(COOPERATIVE_SIGTERM)(
		'spawns a descendant that outlives SIGTERM and hands both to the registry teardown',
		async () => {
			const fake = createFakeBrowserProcess({ descendant: true, ignoreSIGTERM: true })
			spawn(fake.executable, [...fake.args, '--remote-debugging-port=0'], { stdio: 'ignore' })

			const pid = await fake.pid()
			const descendant = await fake.descendant()
			process.kill(pid, 'SIGTERM')
			process.kill(descendant, 'SIGTERM')

			await expect(waitForProcessExit(pid, 300)).rejects.toThrow(
				`Condition "process ${pid} has exited" did not hold within 300ms`,
			)
			expect(isRunning(descendant)).toBe(true)

			await destroyFakeBrowsers()

			expect([isRunning(pid), isRunning(descendant)]).toStrictEqual([false, false])
		},
	)
})

// === Fixture pages

describe('renderFixturePage', () => {
	it('renders every fixture path as a titled document and refuses an unknown path', () => {
		const expected = {
			'/form': 'Delivery form',
			'/form/placed': 'Order placed',
			'/shop': 'Cedar Tea Tray',
			'/shop/cart': 'Cart',
			'/checkout': 'Checkout',
			'/frame/outer': 'Checkout',
			'/frame/inner': 'Payment',
			'/frame/voucher': 'Voucher',
			'/frame/field': 'Voucher form',
			'/frame/done': 'Voucher applied',
			'/frame/local': 'Local voucher',
			'/frame/away': 'Voucher form',
			'/frame/nested': 'Nested',
			'/frame/middle': 'Middle',
			'/search': 'Search',
			'/overlay': 'Overlay',
			'/late': 'Late',
			'/article': 'Field notes',
			'/registry': 'Registry',
			'/confirm': 'Drafts',
			'/beforeunload': 'Unsaved note',
			'/beforeunload/plain': 'Saved note',
			'/beforeunload/next': 'Next note',
			'/popup': 'Catalog',
			'/popup/child': 'Details',
			'/document': 'Gift options',
		}
		const titles = Object.fromEntries(
			Object.keys(expected).map((path) => [
				path,
				/<title>([^<]*)<\/title>/.exec(renderFixturePage(path, 4100) ?? '')?.[1],
			]),
		)

		expect(titles).toStrictEqual(expected)
		expect(renderFixturePage('/missing', 4100)).toBeUndefined()
		expect(renderFixturePage('/form/review', 4100)).toBeUndefined()
	})

	it('frames the localhost inner page on the given port behind a decoy at the frame-local origin', () => {
		const outer = requireValue(renderFixturePage('/frame/outer', 4100))

		expect(outer).toContain('<iframe title="Payment" src="http://localhost:4100/frame/inner">')
		expect(outer).toContain(
			'iframe{position:absolute;left:220px;top:160px;width:300px;height:200px;border:10px solid gray;padding:0}',
		)
		expect(outer).toContain('#decoy{position:absolute;left:0;top:0;width:16px;height:16px;')
		expect(renderFixturePage('/frame/inner', 4100)).toContain(
			'#pay{position:absolute;left:0;top:0;width:16px;height:16px;',
		)
		expect(renderFixturePage('/frame/outer', 4200)).toContain('http://localhost:4200/frame/inner')
	})

	it('submits the form page to its placed page and frames the voucher field from localhost with its action on 127.0.0.1', () => {
		const form = requireValue(renderFixturePage('/form', 4100))

		expect(form).toContain('<form action="/form/placed" method="get">')
		expect(form).toContain('<input id="name" name="name" type="text" value="Ada">')
		expect(form.indexOf('</form>')).toBeLessThan(form.indexOf('<section id="pool"'))
		expect(renderFixturePage('/form/placed', 4100)).toContain("query.get('name')")
		expect(renderFixturePage('/frame/voucher', 4100)).toContain(
			'<iframe title="Voucher form" src="http://localhost:4100/frame/field"></iframe>',
		)
		expect(renderFixturePage('/frame/field', 4200)).toContain(
			'<form action="http://127.0.0.1:4200/frame/done" method="get"><label>Code <input id="code" name="code" type="text"></label><input id="key" name="key" type="hidden"></form>',
		)
		expect(renderFixturePage('/frame/field', 4200)).toContain(
			"document.getElementById('code').addEventListener('keydown', (event) => { if (event.key === 'Enter') document.getElementById('key').value = event.key })",
		)
		expect(renderFixturePage('/frame/done', 4200)).toContain(
			"'Received key ' + new URLSearchParams(location.search).get('key')",
		)
	})

	it('frames the in-process voucher form whose action leaves for localhost, the nested chain across both hosts, and a search form that stays within its document', () => {
		expect(renderFixturePage('/frame/local', 4200)).toContain(
			'<iframe title="Voucher form" src="http://127.0.0.1:4200/frame/away"></iframe>',
		)
		const away = requireValue(renderFixturePage('/frame/away', 4200))
		expect(away).toContain(
			'<form action="http://localhost:4200/frame/done" method="get"><label>Code <input id="code" name="code" type="text"></label><input id="key" name="key" type="hidden"></form>',
		)
		expect(away).toContain(
			"if (event.key === 'Enter') document.getElementById('key').value = event.key",
		)
		expect(renderFixturePage('/frame/nested', 4200)).toContain(
			'<iframe title="Middle" src="http://localhost:4200/frame/middle"></iframe>',
		)
		expect(renderFixturePage('/frame/middle', 4200)).toContain(
			'<iframe title="Payment" src="http://127.0.0.1:4200/frame/inner"></iframe>',
		)
		expect(renderFixturePage('/frame/inner', 4200)).toContain(
			'<form id="coupon" action="/frame/done" method="get" target="_parent"><label>Coupon <input id="code" name="code" type="text"></label></form>',
		)
		expect(renderFixturePage('/search', 4200)).toContain(
			'<form action="#found" method="get"><input name="q" type="hidden" value="tray"><button id="find">Find</button></form>',
		)
	})

	it('asks confirm on Delete, guards leaving the beforeunload page only, and opens the child page from the popup page', () => {
		expect(renderFixturePage('/confirm', 4100)).toContain(
			'onclick="document.body.dataset.answer = String(confirm(\'Delete the draft?\'))">Delete</button>',
		)
		expect(renderFixturePage('/confirm', 4100)).toContain(
			'onclick="document.body.dataset.kept = String(Number(document.body.dataset.kept ?? \'0\') + 1)">Keep</button>',
		)
		expect(renderFixturePage('/beforeunload', 4100)).toContain(
			"addEventListener('beforeunload', (event) => { event.preventDefault(); event.returnValue = '' })",
		)
		expect(renderFixturePage('/beforeunload', 4100)).toContain(
			'<a href="/beforeunload/next">Next</a>',
		)
		expect(renderFixturePage('/beforeunload/plain', 4100)).toContain(
			'<a href="/beforeunload/next">Next</a>',
		)
		expect(renderFixturePage('/beforeunload/plain', 4100)).not.toContain('addEventListener')
		expect(renderFixturePage('/popup', 4100)).toContain(
			"onclick=\"window.open('/popup/child', 'details')\">Open details</button>",
		)
		expect(renderFixturePage('/popup', 4100)).toContain('id="stay"')
	})

	it('imports the built bundle through the document import map and publishes a toolset over the registry double', () => {
		const page = requireValue(renderFixturePage('/document', 4100))
		const imports: unknown = JSON.parse(
			requireValue(/<script type="importmap">(.*)<\/script>/.exec(page)?.[1]),
		)

		expect(imports).toStrictEqual({ imports: { ...FIXTURE_DOCUMENT_IMPORTS } })
		expect(page).toContain("import { createDocumentToolset } from '/dist/src/browser/index.js'")
		expect(page).toContain("import { createModelContext } from '@orkestrel/mcp/browser'")
		expect(page).toContain(`import { installModelContext } from '${FIXTURE_REGISTRY_MODULE}'`)
		expect(page).toContain(
			'createDocumentToolset({ document, own: true, source: createModelContext({ document }) })',
		)
		expect(page).toContain('window.documentToolset = toolset')
	})

	it('schedules the late text on the Reveal click after the late delay', () => {
		const late = requireValue(renderFixturePage('/late', 4100))

		expect(FIXTURE_LATE_TEXT).toBe('Confirmation code 4417')
		expect(FIXTURE_LATE_DELAY).toBe(200)
		expect(late).toContain(`line.textContent = '${FIXTURE_LATE_TEXT}'`)
		expect(late).toContain(`}, ${FIXTURE_LATE_DELAY})">Reveal</button>`)
		expect(late).toContain(
			'append(line); document.body.dataset.inserted = String(performance.timeOrigin + performance.now()) }',
		)
		expect(late).not.toContain(FIXTURE_LATE_TEXT + '</')
	})

	it('prevents the order submission, posts the name, and inserts the confirmation after the checkout delay, beside a gift form that keeps its default action', () => {
		const checkout = requireValue(renderFixturePage('/checkout', 4100))

		expect(FIXTURE_CHECKOUT_CODE).toBe('A1042')
		expect(FIXTURE_CHECKOUT_DELAY).toBe(200)
		expect(checkout).toContain(
			'<form id="order" action="/checkout/order" method="post"><label>Name <input id="name" name="name" type="text"></label></form>',
		)
		expect(checkout).toContain(
			"document.getElementById('order').addEventListener('submit', (event) => {\n\tevent.preventDefault()",
		)
		expect(checkout).toContain(
			"fetch('/checkout/order', { method: 'POST', body: new URLSearchParams({ name }) })",
		)
		expect(checkout).toContain("line.textContent = 'Order ' + code + ' placed for ' + name + '.'")
		expect(checkout).toContain(`}, ${FIXTURE_CHECKOUT_DELAY})`)
		expect(checkout).toContain(
			'<form id="gift" action="/form/placed" method="get"><input name="speed" type="hidden" value="Standard">',
		)
		expect(checkout.match(/preventDefault/g)).toHaveLength(1)
	})
})

describe('FIXTURE_DOCUMENT_IMPORTS', () => {
	// A workspace reached through a linked `node_modules` resolves to the link's target, so the
	// comparison starts at the `node_modules` segment.
	it('maps each specifier to the served path of the entry Node resolves for it', () => {
		const resolved = Object.fromEntries(
			Object.keys(FIXTURE_DOCUMENT_IMPORTS).map((specifier) => [
				specifier,
				fileURLToPath(import.meta.resolve(specifier))
					.split('\\')
					.join('/')
					.replace(/^.*(?=\/node_modules\/)/, ''),
			]),
		)

		expect(resolved).toStrictEqual({ ...FIXTURE_DOCUMENT_IMPORTS })
		expect(Object.keys(FIXTURE_DOCUMENT_IMPORTS)).toContain('@orkestrel/mcp/browser')
	})

	it('names every bare specifier the served modules import, walking every relative import to a served module', async () => {
		const pending = [...Object.values(FIXTURE_DOCUMENT_IMPORTS), FIXTURE_REGISTRY_MODULE]
		const visited = new Set<string>()
		const bare = new Set<string>()
		const unserved: string[] = []
		for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
			if (visited.has(path)) continue
			visited.add(path)
			const source = await loadFixtureModule(path)
			if (source === undefined) {
				unserved.push(path)
				continue
			}
			for (const match of source.matchAll(
				/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g,
			)) {
				const specifier = requireValue(match[1])
				if (specifier.startsWith('.'))
					pending.push(new URL(specifier, `http://127.0.0.1${path}`).pathname)
				else bare.add(specifier)
			}
		}

		expect(visited).toContain('/node_modules/@orkestrel/mcp/dist/src/core/index.js')
		expect(bare).toContain('@orkestrel/sse')
		expect([...bare].filter((specifier) => !(specifier in FIXTURE_DOCUMENT_IMPORTS))).toStrictEqual(
			[],
		)
		expect(unserved).toStrictEqual([])
	})
})

describe('loadFixtureModule', () => {
	it('serves the bundle files and the listed package entries from the root it is given, and no other path', async () => {
		const scratch = createTempDirectory()
		scratch.write('dist/src/browser/index.js', 'export const bundle = "browser"\n')
		scratch.write('dist/src/core/index.js', 'export const bundle = "core"\n')
		scratch.write('dist/src/server/index.js', 'export const bundle = "server"\n')
		const contract = '/node_modules/@orkestrel/contract/dist/src/core/index.js'

		expect(await loadFixtureModule('/dist/src/browser/index.js', scratch.path)).toBe(
			'export const bundle = "browser"\n',
		)
		expect(await loadFixtureModule('/dist/src/core/index.js', scratch.path)).toBe(
			'export const bundle = "core"\n',
		)
		expect(await loadFixtureModule('/dist/src/server/index.js', scratch.path)).toBeUndefined()
		expect(await loadFixtureModule(contract, scratch.path)).toBeUndefined()
		expect(await loadFixtureModule(contract)).toBe(readFileSync(join(WORKSPACE, contract), 'utf8'))
		expect(
			await loadFixtureModule('/node_modules/@orkestrel/contract/package.json'),
		).toBeUndefined()
		expect(await loadFixtureModule('/dist/src/browser/../../../package.json')).toBeUndefined()
		expect(await loadFixtureModule('/document')).toBeUndefined()
	})

	it('serves the registry double with its types removed, and nothing from a root without it', async () => {
		const module = requireValue(await loadFixtureModule(FIXTURE_REGISTRY_MODULE))

		expect(FIXTURE_REGISTRY_MODULE).toBe('/tests/fixtures/modelContext.js')
		expect(module).toContain('export function installModelContext(host)')
		expect(module).not.toContain('import type')
		expect(module).not.toContain('host: Document')
		expect(
			await loadFixtureModule(FIXTURE_REGISTRY_MODULE, createTempDirectory().path),
		).toBeUndefined()
	})
})

describe('requireDocumentBundle', () => {
	it('names npm run build and each absent bundle file, and returns when both are built', () => {
		const empty = createTempDirectory()
		const partial = createTempDirectory()
		partial.write('dist/src/core/index.js', '')
		const built = createTempDirectory()
		built.write('dist/src/browser/index.js', '')
		built.write('dist/src/core/index.js', '')

		expect([...FIXTURE_DOCUMENT_BUNDLE]).toStrictEqual([
			'dist/src/browser/index.js',
			'dist/src/core/index.js',
		])
		expect(() => requireDocumentBundle(empty.path)).toThrow(
			'Precondition failed: dist/src/browser/index.js and dist/src/core/index.js are absent; run npm run build before the document proofs.',
		)
		expect(() => requireDocumentBundle(partial.path)).toThrow(
			'Precondition failed: dist/src/browser/index.js is absent; run npm run build before the document proofs.',
		)
		expect(requireDocumentBundle(built.path)).toBeUndefined()
	})
})

describe('createFixtureServer', () => {
	it('serves each fixture page on both loopback hosts of one port and answers 404 otherwise', async () => {
		const fixtures = await createFixtureServer()
		try {
			expect(fixtures.url('/form')).toBe(`http://127.0.0.1:${fixtures.port}/form`)
			expect(fixtures.url('/frame/inner', 'localhost')).toBe(
				`http://localhost:${fixtures.port}/frame/inner`,
			)

			const outer = await fetch(fixtures.url('/frame/outer'))
			expect(outer.status).toBe(200)
			expect(outer.headers.get('content-type')).toBe('text/html; charset=utf-8')
			expect(await outer.text()).toBe(renderFixturePage('/frame/outer', fixtures.port))

			const inner = await fetch(fixtures.url('/frame/inner', 'localhost'))
			expect(inner.status).toBe(200)
			expect(await inner.text()).toBe(renderFixturePage('/frame/inner', fixtures.port))

			const query = await fetch(fixtures.url('/article?page=2'))
			expect(await query.text()).toBe(renderFixturePage('/article', fixtures.port))

			const middle = await fetch(fixtures.url('/frame/middle', 'localhost'))
			expect(await middle.text()).toBe(renderFixturePage('/frame/middle', fixtures.port))
			const search = await fetch(fixtures.url('/search?q=tray'))
			expect(await search.text()).toBe(renderFixturePage('/search', fixtures.port))

			const missing = await fetch(fixtures.url('/missing'))
			expect(missing.status).toBe(404)
			expect(await missing.text()).toBe('')

			const contract = '/node_modules/@orkestrel/contract/dist/src/core/index.js'
			const module = await fetch(fixtures.url(contract))
			expect(module.status).toBe(200)
			expect(module.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
			expect(await module.text()).toBe(readFileSync(join(WORKSPACE, contract), 'utf8'))

			const manifest = await fetch(fixtures.url('/node_modules/@orkestrel/contract/package.json'))
			expect(manifest.status).toBe(404)
			await manifest.text()
		} finally {
			await fixtures.destroy()
		}
	})

	it('answers a POST to the cart with a 303 to the cart page, and a GET of the cart with the page', async () => {
		const fixtures = await createFixtureServer()
		try {
			const posted = await fetch(fixtures.url('/shop/cart'), {
				method: 'POST',
				body: new URLSearchParams({ item: 'Cedar Tea Tray' }),
				redirect: 'manual',
			})
			expect([posted.status, posted.headers.get('location'), await posted.text()]).toEqual([
				303,
				'/shop/cart',
				'',
			])
			const cart = await fetch(fixtures.url('/shop/cart'))
			expect([cart.status, await cart.text()]).toEqual([
				200,
				renderFixturePage('/shop/cart', fixtures.port),
			])
		} finally {
			await fixtures.destroy()
		}
	})

	it('answers a POST of an order with the order code as plain text, and a GET of the order path with 404', async () => {
		const fixtures = await createFixtureServer()
		try {
			const posted = await fetch(fixtures.url('/checkout/order'), {
				method: 'POST',
				body: new URLSearchParams({ name: 'Ada Lovelace' }),
			})
			expect([posted.status, posted.headers.get('content-type'), await posted.text()]).toEqual([
				200,
				'text/plain; charset=utf-8',
				FIXTURE_CHECKOUT_CODE,
			])
			const fetched = await fetch(fixtures.url('/checkout/order'))
			expect([fetched.status, await fetched.text()]).toEqual([404, ''])
		} finally {
			await fixtures.destroy()
		}
	})

	it('closes an established connection on destroy and tolerates a second destroy', async () => {
		const fixtures = await createFixtureServer()
		const client = createConnection({ host: '127.0.0.1', port: fixtures.port })
		const closes = createRecorder<[]>()
		client.on('close', closes.handler)
		client.on('error', () => undefined)
		const answered = waitForEvent<[Buffer]>(
			(listener) => {
				client.once('data', listener)
				return () => client.off('data', listener)
			},
			'the fixture answered the keep-alive request',
			{ budget: 2000 },
		)
		client.write('GET /form HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n')
		const [head] = await answered

		expect(head.toString('utf8')).toMatch(/^HTTP\/1\.1 200 OK\r\n/)
		expect(closes.count).toBe(0)

		await fixtures.destroy()
		await waitForCondition(
			'the fixture closed the established connection',
			() => closes.count === 1,
			{
				budget: 2000,
				interval: 10,
			},
		)
		await expect(fixtures.destroy()).resolves.toBeUndefined()
		expect(closes.count).toBe(1)
	})
})

// === Compiled journey modules

describe('createBrowserJourneyStage', () => {
	it('links the workspace package, imports a module through Node, reads the receipts it recorded, and removes only its own directory', async () => {
		const stage = createBrowserJourneyStage()
		const { client, page } = await createAttachedPage()
		const greeting = stage.load(
			'greeting.js',
			"export const actions = []\n\nexport async function execute(page, inputs) {\n\tactions.push({ receipt: 'Greeted ' + inputs.name + ' on ' + page.target + '.' })\n}\n",
		)
		await greeting.execute(page, { name: 'Grace' })
		const linked = realpathSync(join(stage.path, 'node_modules/@orkestrel/browser'))

		expect(linked).toBe(realpathSync(WORKSPACE))
		expect(greeting.receipts()).toStrictEqual(['Greeted Grace on target-1.'])
		stage.destroy()
		await client.close()
		expect([existsSync(stage.path), existsSync(join(WORKSPACE, 'package.json'))]).toStrictEqual([
			false,
			true,
		])
	})

	it('refuses a module that exports no execute, and reads no receipts from one that exports no actions', () => {
		const stage = createBrowserJourneyStage()
		const silent = stage.load('silent.js', 'export async function execute() {}\n')

		expect(() => stage.load('empty.js', 'export const actions = []\n')).toThrow(
			'empty.js exports no execute function',
		)
		expect(() => silent.receipts()).toThrow('silent.js exports no actions array')
		stage.destroy()
	})
})
