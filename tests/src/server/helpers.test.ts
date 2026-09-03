/**
 * src/server/helpers.ts tests.
 *
 * `fetchCDPTargets` / `waitForCDPReady` are exercised against a real
 * in-process HTTP server (`createCDPTestServer`). `findSystemBrowsers` /
 * `findSystemBrowser` are exercised through their `SystemBrowserOptions`
 * override bag with real temp files/dirs (`node:fs`) so every assertion is
 * deterministic across machines — no mocking, no dependency on what happens
 * to be installed. `launchBrowserProcess` argument construction is verified
 * by spawning the real Node binary as a stand-in executable and reading
 * `ChildProcess.spawnargs` — the exact argv passed to the OS — never a mock
 * of `child_process`.
 */

import type { ScratchInterface } from '@orkestrel/test/server'
import { describe, it, expect, afterEach } from 'vitest'
import { chmodSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, delimiter } from 'node:path'
import { requireValue } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import {
	createBrowserProfile,
	findSystemBrowsers,
	findSystemBrowser,
	findStorePaths,
	parseBrowserEngine,
	launchBrowserProcess,
	probePathNames,
	readFirstLine,
	removeBrowserProfile,
	waitForCDPReady,
	fetchCDPTargets,
	isBrowserConnectionError,
} from '@src/server'
import { createCDPTestServer } from '../../setupServer.js'
import type { CDPTestServerInterface } from '../../setupServer.js'

let server: CDPTestServerInterface | undefined
const scratches: ScratchInterface[] = []
afterEach(async () => {
	await server?.close()
	server = undefined
	for (const scratch of scratches.splice(0)) scratch.destroy()
})

describe('findSystemBrowser', () => {
	it('returns undefined when every candidate source is empty', () => {
		const found = findSystemBrowser({ env: {}, paths: [], names: [], stores: [] })
		expect(found).toBeUndefined()
	})

	it('returns a planted path candidate when it exists', () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-test-' })
		scratches.push(scratch)
		const file = join(scratch.path, 'chrome')
		scratch.write('chrome', '')

		const found = findSystemBrowser({ env: {}, paths: [file], names: [], stores: [] })

		expect(found).toEqual({ executable: file, engine: 'chrome' })
	})

	it('prefers an env override over a path candidate', () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-test-' })
		scratches.push(scratch)
		const envFile = join(scratch.path, 'env-chrome')
		const pathFile = join(scratch.path, 'path-chrome')
		scratch.write('env-chrome', '')
		scratch.write('path-chrome', '')

		const found = findSystemBrowser({
			env: { PLAYWRIGHT_EXECUTABLE_PATH: envFile },
			paths: [pathFile],
			names: [],
			stores: [],
		})

		expect(found?.executable).toBe(envFile)
	})

	it('falls through to CHROME_PATH when PLAYWRIGHT_EXECUTABLE_PATH is absent', () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-test-' })
		scratches.push(scratch)
		const chromePathFile = join(scratch.path, 'chrome-path-chrome')
		scratch.write('chrome-path-chrome', '')

		const found = findSystemBrowser({
			env: { CHROME_PATH: chromePathFile },
			paths: [],
			names: [],
			stores: [],
		})

		expect(found?.executable).toBe(chromePathFile)
	})

	it('resolves a versioned Chromium install inside a browser store', () => {
		// Mirrors the current platform's store shape (per BROWSER_STORE_GLOBS in
		// src/server/constants.ts) so this test is honest everywhere it runs:
		// linux -> chromium-<rev>/chrome-linux/chrome
		// darwin -> chromium-<rev>/chrome-mac/Chromium.app/Contents/MacOS/Chromium
		// win32 -> chromium-<rev>/chrome-win/chrome.exe
		const scratch = createScratch({ prefix: 'orkestrel-browser-test-' })
		scratches.push(scratch)
		const relative =
			process.platform === 'win32'
				? join('chromium-1194', 'chrome-win', 'chrome.exe')
				: process.platform === 'darwin'
					? join('chromium-1194', 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
					: join('chromium-1194', 'chrome-linux', 'chrome')
		scratch.write(relative, '')
		const binary = join(scratch.path, relative)

		const found = findSystemBrowser({ env: {}, paths: [], names: [], stores: [scratch.path] })

		expect(found).toEqual({ executable: binary, engine: 'chromium' })
	})

	it('resolves the top-level chromium link inside a browser store', () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-test-' })
		scratches.push(scratch)
		const link = join(scratch.path, 'chromium')
		scratch.write('chromium', '')

		const found = findSystemBrowser({ env: {}, paths: [], names: [], stores: [scratch.path] })

		expect(found).toEqual({ executable: link, engine: 'chromium' })
	})
})

describe('findSystemBrowsers', () => {
	it('returns an empty array when every candidate source is empty', () => {
		expect(findSystemBrowsers({ env: {}, paths: [], names: [], stores: [] })).toEqual([])
	})

	it('returns every planted candidate in resolution-precedence order with classified engines', () => {
		const dirScratch = createScratch({ prefix: 'orkestrel-browser-test-' })
		scratches.push(dirScratch)
		const envFile = join(dirScratch.path, 'msedge')
		const pathFile = join(dirScratch.path, 'google-chrome')
		dirScratch.write('msedge', '')
		dirScratch.write('google-chrome', '')

		const storeScratch = createScratch({ prefix: 'orkestrel-browser-test-' })
		scratches.push(storeScratch)
		const link = join(storeScratch.path, 'chromium')
		storeScratch.write('chromium', '')

		const found = findSystemBrowsers({
			env: { PLAYWRIGHT_EXECUTABLE_PATH: envFile },
			paths: [pathFile],
			names: [],
			stores: [storeScratch.path],
		})

		expect(found).toEqual([
			{ executable: envFile, engine: 'edge' },
			{ executable: pathFile, engine: 'chrome' },
			{ executable: link, engine: 'chromium' },
		])
	})

	it('dedupes a candidate reachable through two sources by normalized path', () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-test-' })
		scratches.push(scratch)
		const shared = join(scratch.path, 'chrome')
		scratch.write('chrome', '')

		const found = findSystemBrowsers({
			env: { PLAYWRIGHT_EXECUTABLE_PATH: shared },
			paths: [shared],
			names: [],
			stores: [],
		})

		expect(found).toEqual([{ executable: shared, engine: 'chrome' }])
	})

	it('narrows results to the requested engine', () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-test-' })
		scratches.push(scratch)
		const edgeFile = join(scratch.path, 'msedge')
		const chromeFile = join(scratch.path, 'google-chrome')
		scratch.write('msedge', '')
		scratch.write('google-chrome', '')

		const found = findSystemBrowsers({
			env: {},
			paths: [edgeFile, chromeFile],
			names: [],
			stores: [],
			engine: 'edge',
		})

		expect(found).toEqual([{ executable: edgeFile, engine: 'edge' }])
	})

	it('returns an empty array when the engine filter matches nothing', () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-test-' })
		scratches.push(scratch)
		const chromeFile = join(scratch.path, 'google-chrome')
		scratch.write('google-chrome', '')

		const found = findSystemBrowsers({
			env: {},
			paths: [chromeFile],
			names: [],
			stores: [],
			engine: 'edge',
		})

		expect(found).toEqual([])
	})
})

describe('readFirstLine', () => {
	it('returns the first CRLF line without its carriage return', () => {
		expect(readFirstLine('C:\\bin\\chrome.exe\r\nC:\\other\\chrome.exe\r\n')).toBe(
			'C:\\bin\\chrome.exe',
		)
	})

	it('returns the first line of LF-separated output', () => {
		expect(readFirstLine('/usr/bin/chromium\n/opt/chromium\n')).toBe('/usr/bin/chromium')
	})

	it('skips leading blank lines', () => {
		expect(readFirstLine('\r\n\r\n/usr/bin/chromium\r\n')).toBe('/usr/bin/chromium')
	})

	it('returns undefined when the output carries no text', () => {
		expect(readFirstLine('')).toBeUndefined()
		expect(readFirstLine('\r\n \r\n')).toBeUndefined()
	})
})

describe('probePathNames', () => {
	it('returns an existing path for a name PATH resolves more than once', () => {
		// Plants the same command in two scratch directories and puts both on
		// PATH, so the real `where`/`which` reports multiple matches. Windows
		// separates them with CRLF, which the returned path must not carry.
		const first = createScratch({ prefix: 'orkestrel-browser-test-' })
		const second = createScratch({ prefix: 'orkestrel-browser-test-' })
		scratches.push(first, second)
		const name = 'orkestrel-browser-probe-fixture'
		const file = process.platform === 'win32' ? `${name}.exe` : name
		for (const scratch of [first, second]) {
			scratch.write(file, '')
			if (process.platform !== 'win32') chmodSync(join(scratch.path, file), 0o755)
		}

		const original = process.env['PATH']
		process.env['PATH'] = [first.path, second.path, original ?? ''].join(delimiter)
		try {
			const found = probePathNames([name], process.platform)

			expect(found).toEqual([join(first.path, file)])
			expect(existsSync(requireValue(found[0], 'PATH probe returned no path'))).toBe(true)
		} finally {
			process.env['PATH'] = original
		}
	})

	it('returns nothing for a name PATH cannot resolve', () => {
		expect(probePathNames(['orkestrel-browser-absent-fixture'], process.platform)).toEqual([])
	})
})

describe('findStorePaths', () => {
	it('orders multi-digit browser revisions numerically from newest to oldest', () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-test-' })
		scratches.push(scratch)
		const relatives = ['99', '100'].map((revision) =>
			process.platform === 'win32'
				? join(`chromium-${revision}`, 'chrome-win', 'chrome.exe')
				: process.platform === 'darwin'
					? join(
							`chromium-${revision}`,
							'chrome-mac',
							'Chromium.app',
							'Contents',
							'MacOS',
							'Chromium',
						)
					: join(`chromium-${revision}`, 'chrome-linux', 'chrome'),
		)
		for (const relative of relatives) scratch.write(relative, '')
		const binaries = relatives.map((relative) => join(scratch.path, relative))

		expect(findStorePaths(scratch.path, process.platform)).toEqual([...binaries].reverse())
	})
})

describe('parseBrowserEngine', () => {
	it('classifies msedge/microsoft-edge/edge hints as edge', () => {
		expect(parseBrowserEngine('/usr/bin/msedge')).toBe('edge')
		expect(parseBrowserEngine('/opt/microsoft-edge/microsoft-edge')).toBe('edge')
		expect(parseBrowserEngine('C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe')).toBe(
			'edge',
		)
	})

	it('classifies chromium/pw-browsers/chrome-linux/chrome-win/chrome-mac/chrome_headless hints as chromium', () => {
		expect(parseBrowserEngine('/usr/bin/chromium')).toBe('chromium')
		expect(parseBrowserEngine('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')).toBe(
			'chromium',
		)
		expect(parseBrowserEngine('chromium-1194/chrome-win/chrome.exe')).toBe('chromium')
		expect(parseBrowserEngine('chromium-1194/chrome-mac/Chromium')).toBe('chromium')
		expect(parseBrowserEngine('chrome_headless-shell')).toBe('chromium')
	})

	it('classifies google-chrome hints as chrome', () => {
		expect(parseBrowserEngine('/usr/bin/google-chrome-stable')).toBe('chrome')
		expect(parseBrowserEngine('/Applications/Google/Chrome.app/Contents/MacOS/Google Chrome')).toBe(
			'chrome',
		)
		expect(parseBrowserEngine('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')).toBe(
			'chrome',
		)
	})

	it('returns undefined for an unrecognizable executable', () => {
		expect(parseBrowserEngine('/usr/bin/some-random-binary')).toBeUndefined()
	})
})

describe('waitForCDPReady', () => {
	it('resolves the WebSocket debugger URL once the endpoint is ready', async () => {
		server = await createCDPTestServer()
		const url = await waitForCDPReady(server.port, 2000)
		expect(url).toBe(server.endpoint)
	})

	it('throws when the endpoint never becomes ready before the timeout', async () => {
		await expect(waitForCDPReady(19_992, 100)).rejects.toThrow(/did not become ready/)
	})

	it('respects the deadline against a hanging endpoint', async () => {
		server = await createCDPTestServer()
		server.hang(true)
		const start = performance.now()
		await expect(waitForCDPReady(server.port, 150)).rejects.toThrow(/did not become ready/)
		expect(performance.now() - start).toBeLessThan(1000)
	})

	it('honors an explicit host', async () => {
		server = await createCDPTestServer()
		const url = await waitForCDPReady(server.port, 2000, '127.0.0.1')
		expect(url).toBe(server.endpoint)
	})

	it('aborts an in-flight endpoint request promptly', async () => {
		server = await createCDPTestServer()
		server.hang(true)
		const controller = new AbortController()
		const start = performance.now()
		const pending = waitForCDPReady(server.port, 5000, '127.0.0.1', controller.signal)

		controller.abort()

		await expect(pending).rejects.toThrow(/abort/i)
		expect(performance.now() - start).toBeLessThan(1000)
	})
})

describe('fetchCDPTargets', () => {
	it('returns normalized targets from /json/list', async () => {
		server = await createCDPTestServer()
		server.list([{ id: 't1', type: 'page', title: 'Home', url: 'https://example.com' }])

		const result = await fetchCDPTargets(server.port, 2000)

		expect(result).toEqual({
			success: true,
			value: [{ id: 't1', category: 'page', title: 'Home', url: 'https://example.com' }],
		})
	})

	it('reports a coded failure when the endpoint is unreachable', async () => {
		const result = await fetchCDPTargets(19_993, 100)
		expect(result.success).toBe(false)
		if (result.success) throw new Error('An unreachable endpoint must not succeed')
		expect(isBrowserConnectionError(result.error)).toBe(true)
		expect(result.error.code).toBe('BROWSER_CONNECTION_ERROR')
	})

	it('accepts targets with empty title/url', async () => {
		server = await createCDPTestServer()
		server.list([{ id: 't2', type: 'page', title: '', url: '' }])

		const result = await fetchCDPTargets(server.port, 2000)

		expect(result).toEqual({
			success: true,
			value: [{ id: 't2', category: 'page', title: '', url: '' }],
		})
	})

	it('skips targets missing required string fields instead of substituting sentinels', async () => {
		server = await createCDPTestServer()
		server.list([
			{ id: 'missing-title', type: 'page', url: 'https://example.com' },
			{ id: 'missing-url', type: 'page', title: 'Example' },
		])

		expect(await fetchCDPTargets(server.port, 2000)).toEqual({ success: true, value: [] })
	})

	it('honors an explicit host', async () => {
		server = await createCDPTestServer()
		server.list([{ id: 't3', type: 'page', title: '', url: '' }])

		const result = await fetchCDPTargets(server.port, 2000, '127.0.0.1')

		expect(result).toEqual({
			success: true,
			value: [{ id: 't3', category: 'page', title: '', url: '' }],
		})
	})
})

describe('launchBrowserProcess', () => {
	// Uses the real Node binary as a stand-in executable — a real
	// `child_process.spawn()` call, not a mock. `ChildProcess.spawnargs`
	// reports the exact argv passed to the OS, so argument construction is
	// verified without depending on the child staying alive.

	it('includes the debugging-port and headless flags', () => {
		const port = 19_994
		const process = launchBrowserProcess(globalThis.process.execPath, port, true, undefined, [
			'--extra-flag',
		])
		try {
			expect(process.spawnargs).toContain(`--remote-debugging-port=${port}`)
			expect(process.spawnargs).toContain('--headless=new')
			expect(process.spawnargs).toContain('--no-first-run')
			expect(process.spawnargs).toContain('--no-default-browser-check')
			expect(process.spawnargs).toContain('--extra-flag')
		} finally {
			process.kill()
		}
	})

	it('omits the headless flag when headless is false', () => {
		const process = launchBrowserProcess(globalThis.process.execPath, 19_995, false)
		try {
			expect(process.spawnargs).not.toContain('--headless=new')
		} finally {
			process.kill()
		}
	})

	it('includes a user-data-dir flag when a profile is given', () => {
		const process = launchBrowserProcess(
			globalThis.process.execPath,
			19_996,
			false,
			'/tmp/test-profile',
		)
		try {
			expect(process.spawnargs).toContain('--user-data-dir=/tmp/test-profile')
		} finally {
			process.kill()
		}
	})

	it('omits the user-data-dir flag when no profile is given', () => {
		const process = launchBrowserProcess(globalThis.process.execPath, 19_997, false)
		try {
			expect(process.spawnargs.some((a) => a.startsWith('--user-data-dir='))).toBe(false)
		} finally {
			process.kill()
		}
	})
})

describe('browser profiles', () => {
	it('creates and removes an isolated profile beneath the operating-system temp directory', async () => {
		const profile = await createBrowserProfile()
		try {
			expect(profile.temporary).toBe(true)
			expect(dirname(profile.path)).toBe(tmpdir())
			expect(existsSync(profile.path)).toBe(true)
			writeFileSync(join(profile.path, 'fixture'), 'profile data')
		} finally {
			await removeBrowserProfile(profile)
		}

		expect(existsSync(profile.path)).toBe(false)
		await expect(removeBrowserProfile(profile)).resolves.toBeUndefined()
	})

	it('preserves a caller-owned persistent profile', async () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-test-' })
		scratches.push(scratch)
		const profile = await createBrowserProfile(scratch.path)

		expect(profile).toEqual({ path: scratch.path, temporary: false })
		await removeBrowserProfile(profile)
		// `existsSync` checks the scratch's own root directory, which is not a
		// containment-checked target `scratch.has()` accepts — it stays on
		// `node:fs`.
		expect(existsSync(scratch.path)).toBe(true)
	})

	it('refuses recursive removal outside the guarded temp-profile shape', async () => {
		await expect(removeBrowserProfile({ path: tmpdir(), temporary: true })).rejects.toThrow(
			'Refusing to remove an unsafe browser profile path',
		)
	})
})
