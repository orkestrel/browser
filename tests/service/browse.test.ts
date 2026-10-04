import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createTeardown, requireValue, waitForCondition } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { describe, expect, it } from 'vitest'
import {
	createBrowserMCPServer,
	createBrowser,
	probeProcess,
	parseBrowserProfileRecord,
	formatBrowserLockEntry,
} from '@src/server'
import {
	BrowseLauncher,
	createEagerBrowseChild,
	requireSystemBrowser,
	BROWSE_RECORD_BLOCKS,
} from '../setupService.js'
import {
	BrowseLog,
	MCPStdioPair,
	createFixtureServer,
	waitForProcessExit,
	readExitedProcessId,
} from '../setupServer.js'

describe('eager U6 real browse', () => {
	it('sweeps a killed server according to the launch process model', async () => {
		const scratch = createScratch()
		const executable = requireSystemBrowser().executable
		const child = createEagerBrowseChild(scratch.path, executable)
		const server = createBrowserMCPServer({
			root: scratch.path,
			executable,
			stdio: new MCPStdioPair(),
			log: new BrowseLog(),
		})
		let orphan: number | undefined
		try {
			await Promise.race([
				waitForCondition('child ready', () => child.lines.includes('ready'), { budget: 20000 }),
				child.ending.then(() => {
					throw new Error(child.stderr)
				}),
			])
			const profile = join(
				scratch.path,
				'.profiles',
				requireValue(readdirSync(join(scratch.path, '.profiles'))[0], 'profile'),
			)
			const record = requireValue(
				parseBrowserProfileRecord(readFileSync(join(profile, 'browse.json'), 'utf8')),
				'record',
			)
			orphan = record.pid
			expect(
				probeProcess(record.pid),
				`browser ${record.pid} before killing server ${child.pid}; executable ${executable}`,
			).toBe(true)
			child.kill('SIGKILL')
			await child.ending
			// spawnBrowserProcess (src/server/helpers.ts:431) detaches only off Windows.
			if (process.platform === 'win32') await waitForProcessExit(record.pid)
			expect(
				probeProcess(record.pid),
				`browser ${record.pid} after killing server ${child.pid}; executable ${executable}`,
			).toBe(process.platform !== 'win32')
			await server.start()
			await waitForProcessExit(record.pid)
			if (process.platform === 'win32')
				await waitForCondition('start removed the dead record folder', () => !existsSync(profile))
			await server.destroy()
			expect(existsSync(profile)).toBe(false)
		} finally {
			await server.destroy()
			await child.destroy()
			if (orphan !== undefined && probeProcess(orphan)) {
				process.kill(orphan, 'SIGKILL')
				await waitForProcessExit(orphan)
			}
			scratch.destroy()
		}
	})
	it('sweeps a synthesized live orphan recorded under an exited owner', async () => {
		const scratch = createScratch()
		const executable = requireSystemBrowser().executable
		const browser = createBrowser({
			executable,
			headless: true,
			profile: scratch.ensure('owned'),
			cdp: { discover: false },
			...(process.platform === 'linux' && process.getuid?.() === 0
				? { args: ['--no-sandbox'] }
				: {}),
		})
		const root = scratch.ensure('server')
		const server = createBrowserMCPServer({
			root,
			executable,
			stdio: new MCPStdioPair(),
			log: new BrowseLog(),
		})
		try {
			await browser.connect()
			const pid = requireValue(browser.pid, 'orphan pid')
			const endpoint = requireValue(browser.endpoint, 'orphan endpoint')
			const folder = scratch.ensure(
				join('server', '.profiles', formatBrowserLockEntry(readExitedProcessId(), randomUUID())),
			)
			writeFileSync(join(folder, 'browse.json'), JSON.stringify({ pid, endpoint }))
			expect(probeProcess(pid)).toBe(true)
			await server.start()
			await waitForProcessExit(pid)
			expect(probeProcess(pid)).toBe(false)
			await server.destroy()
			expect(existsSync(folder)).toBe(false)
		} finally {
			await server.destroy()
			await browser.destroy()
			scratch.destroy()
		}
	})
	it('starts connected, keeps navigate and look on one pid, and tears down the floor', async () => {
		const scratch = createScratch()
		const launcher = new BrowseLauncher()
		const pair = new MCPStdioPair()
		const log = new BrowseLog()
		const fixture = await createFixtureServer()
		const listeners = {
			SIGINT: process.listenerCount('SIGINT'),
			SIGTERM: process.listenerCount('SIGTERM'),
		}
		const server = createBrowserMCPServer({
			root: scratch.path,
			executable: requireSystemBrowser().executable,
			pool: { size: 2 },
			launch: launcher.launch,
			stdio: pair,
			log,
		})
		const teardown = createTeardown()
		teardown.add(() => scratch.destroy())
		teardown.add(() => fixture.destroy())
		teardown.add(() => server.destroy())
		try {
			await server.start()
			expect(launcher.connections.length).toBeGreaterThanOrEqual(1)
			await waitForCondition('both browsers connected', () => launcher.connections.length === 2, {
				budget: 15000,
			})
			const pid = requireValue(launcher.connections[0]?.pid, 'lease pid')
			expect(probeProcess(pid)).toBe(true)
			await pair.initialize()
			expect((await pair.call(2, 'navigate', { url: fixture.url('/form') })).error).toBe(false)
			expect((await pair.call(3, 'look', { search: 'button' })).error).toBe(false)
			expect(launcher.browsers[0]?.pid).toBe(pid)
			const spare = requireValue(launcher.browsers[1], 'spare')
			await waitForCondition(
				'the spare isolated page',
				() =>
					spare
						.contexts()
						.some((context) => context.id !== undefined && context.pages().length > 0),
				{ budget: 15000 },
			)
			expect(
				spare
					.contexts()
					.filter((context) => context.id !== undefined)
					.flatMap((context) => context.pages())
					.map((page) => page.url),
			).toEqual(['about:blank'])
			for (const connection of launcher.connections) {
				const profile = requireValue(connection.options.profile, 'profile')
				expect(
					parseBrowserProfileRecord(readFileSync(join(profile, 'browse.json'), 'utf8')),
				).toEqual({ pid: connection.pid, endpoint: connection.endpoint })
			}
			await server.destroy()
			for (const connection of launcher.connections) {
				await waitForProcessExit(requireValue(connection.pid, 'pid'))
				expect(probeProcess(requireValue(connection.pid, 'pid'))).toBe(false)
				const endpoint = new URL(requireValue(connection.endpoint, 'endpoint'))
				await expect(fetch(`http://127.0.0.1:${endpoint.port}/json/version`)).rejects.toMatchObject(
					{ cause: { code: 'ECONNREFUSED' } },
				)
				expect(existsSync(requireValue(connection.options.profile, 'profile'))).toBe(false)
			}
			expect(readdirSync(join(scratch.path, '.profiles'))).toEqual([])
			expect(process.listenerCount('SIGINT')).toBe(listeners.SIGINT)
			expect(process.listenerCount('SIGTERM')).toBe(listeners.SIGTERM)
			expect(pair.input.listenerCount('data')).toBe(0)
		} finally {
			await teardown.destroy()
		}
	})

	it('refuses a missing executable after exactly two launches with no profile', async () => {
		requireSystemBrowser()
		const scratch = createScratch()
		const launcher = new BrowseLauncher()
		const pair = new MCPStdioPair()
		const server = createBrowserMCPServer({
			root: scratch.path,
			executable: join(scratch.path, 'missing.exe'),
			launch: launcher.launch,
			stdio: pair,
			log: new BrowseLog(),
		})
		try {
			await expect(server.start()).rejects.toThrow('ENOENT')
			expect(await pair.initialize()).toMatchObject({
				code: -32000,
				data: { code: 'BROWSER_SERVER_UNAVAILABLE' },
			})
			expect(launcher.browsers).toHaveLength(2)
			expect(readdirSync(join(scratch.path, '.profiles'))).toEqual([])
		} finally {
			await server.destroy()
			scratch.destroy()
		}
	})

	it.each(BROWSE_RECORD_BLOCKS)(
		'fails the warm and tears down when the profile record path %s is blocked',
		async (blocked) => {
			const scratch = createScratch()
			const browsers: Array<ReturnType<typeof createBrowser>> = []
			const executable = requireSystemBrowser().executable
			const server = createBrowserMCPServer({
				root: scratch.path,
				executable,
				stdio: new MCPStdioPair(),
				log: new BrowseLog(),
				launch: (options) => {
					const browser = createBrowser(options)
					browsers.push(browser)
					browser.emitter.on('connect', () =>
						mkdirSync(join(requireValue(options.profile, 'profile'), blocked)),
					)
					return browser
				},
			})
			try {
				await expect(server.start()).rejects.toMatchObject({ code: 'BROWSER_SERVER_UNAVAILABLE' })
				expect(browsers).toHaveLength(2)
				expect(browsers.every((browser) => browser.pid === undefined)).toBe(true)
				expect(readdirSync(join(scratch.path, '.profiles'))).toEqual([])
			} finally {
				await server.destroy()
				scratch.destroy()
			}
		},
	)
})
