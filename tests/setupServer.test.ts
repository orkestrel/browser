/**
 * Proof for `tests/setupServer.ts`.
 *
 * The subject is the Node-only test infrastructure `tests/src/server/**` drives: the port
 * reservation helpers, the process wait, the scratch registry, the raw TCP fixtures, the in-process
 * CDP server, and the spawned fake browser. Every case uses the real resource the fixture exists to
 * provide — real loopback sockets on ephemeral ports, real files, and real child processes.
 *
 * `tests/setupServer.ts` declares no DOM-driving export, so this file defers nothing to a browser
 * suite. This package registers no browser project.
 *
 * Expected values are derived by a route the module does not share: a second socket connecting to
 * the port `readServerPort` reports, the platform `WebSocket` client driving the CDP fixture, the
 * child's own `spawn` handle carrying the identifier the fixture publishes, and `existsSync` reading
 * the directories the scratch registry removes.
 */

import type { CDPTestServerInterface } from './setupServer.js'
import { afterAll, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createConnection, createServer } from 'node:net'
import { basename, join } from 'node:path'
import { readProperty, requireValue, retryUntil, waitForCondition } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import {
	COOPERATIVE_SIGTERM,
	createCDPTestServer,
	createFakeBrowserProcess,
	createStallServer,
	createTCPProxy,
	createTempDirectory,
	destroyFakeBrowsers,
	destroyTempDirectories,
	readFixtureProcessId,
	readServerPort,
	reservePort,
	StallServer,
	waitForProcessExit,
} from './setupServer.js'

afterAll(async () => {
	await destroyFakeBrowsers()
	await destroyTempDirectories()
})

// === Ports

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
			`ws://localhost:${server.port}/cdp`,
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
