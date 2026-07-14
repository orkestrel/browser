/**
 * src/server/helpers.ts tests.
 *
 * `fetchCdpTargets` / `waitForCdpReady` are exercised against a real
 * in-process HTTP server (`createCdpTestServer`). `findSystemBrowsers` /
 * `findSystemBrowser` are exercised through their `SystemBrowserOptions`
 * override bag with real temp files/dirs (`node:fs`) so every assertion is
 * deterministic across machines — no mocking, no dependency on what happens
 * to be installed. `launchBrowserProcess` argument construction is verified
 * by spawning the real Node binary as a stand-in executable and reading
 * `ChildProcess.spawnargs` — the exact argv passed to the OS — never a mock
 * of `child_process`.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import {
	findSystemBrowsers,
	findSystemBrowser,
	parseBrowserEngine,
	launchBrowserProcess,
	waitForCdpReady,
	fetchCdpTargets,
} from '@src/server'
import { createCdpTestServer } from '../../setupServer.js'
import type { CDPTestServerInterface } from '../../setupServer.js'

let server: CDPTestServerInterface | undefined
const tempDirs: string[] = []

afterEach(async () => {
	await server?.close()
	server = undefined

	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true })
	}
})

function createTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'browser-test-'))
	tempDirs.push(dir)
	return dir
}

describe('findSystemBrowser', () => {
	it('returns undefined when every candidate source is empty', () => {
		const found = findSystemBrowser({ env: {}, paths: [], names: [], stores: [] })
		expect(found).toBeUndefined()
	})

	it('returns a planted path candidate when it exists', () => {
		const dir = createTempDir()
		const file = join(dir, 'chrome')
		writeFileSync(file, '')

		const found = findSystemBrowser({ env: {}, paths: [file], names: [], stores: [] })

		expect(found).toEqual({ executable: file, engine: 'chrome' })
	})

	it('prefers an env override over a path candidate', () => {
		const dir = createTempDir()
		const envFile = join(dir, 'env-chrome')
		const pathFile = join(dir, 'path-chrome')
		writeFileSync(envFile, '')
		writeFileSync(pathFile, '')

		const found = findSystemBrowser({
			env: { PLAYWRIGHT_EXECUTABLE_PATH: envFile },
			paths: [pathFile],
			names: [],
			stores: [],
		})

		expect(found?.executable).toBe(envFile)
	})

	it('falls through to CHROME_PATH when PLAYWRIGHT_EXECUTABLE_PATH is absent', () => {
		const dir = createTempDir()
		const chromePathFile = join(dir, 'chrome-path-chrome')
		writeFileSync(chromePathFile, '')

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
		const store = createTempDir()
		const binary =
			process.platform === 'win32'
				? join(store, 'chromium-1194', 'chrome-win', 'chrome.exe')
				: process.platform === 'darwin'
					? join(
							store,
							'chromium-1194',
							'chrome-mac',
							'Chromium.app',
							'Contents',
							'MacOS',
							'Chromium',
						)
					: join(store, 'chromium-1194', 'chrome-linux', 'chrome')
		mkdirSync(dirname(binary), { recursive: true })
		writeFileSync(binary, '')

		const found = findSystemBrowser({ env: {}, paths: [], names: [], stores: [store] })

		expect(found).toEqual({ executable: binary, engine: 'chromium' })
	})

	it('resolves the top-level chromium link inside a browser store', () => {
		const store = createTempDir()
		const link = join(store, 'chromium')
		writeFileSync(link, '')

		const found = findSystemBrowser({ env: {}, paths: [], names: [], stores: [store] })

		expect(found).toEqual({ executable: link, engine: 'chromium' })
	})
})

describe('findSystemBrowsers', () => {
	it('returns an empty array when every candidate source is empty', () => {
		expect(findSystemBrowsers({ env: {}, paths: [], names: [], stores: [] })).toEqual([])
	})

	it('returns every planted candidate in resolution-precedence order with classified engines', () => {
		const dir = createTempDir()
		const envFile = join(dir, 'msedge')
		const pathFile = join(dir, 'google-chrome')
		writeFileSync(envFile, '')
		writeFileSync(pathFile, '')

		const store = createTempDir()
		const link = join(store, 'chromium')
		writeFileSync(link, '')

		const found = findSystemBrowsers({
			env: { PLAYWRIGHT_EXECUTABLE_PATH: envFile },
			paths: [pathFile],
			names: [],
			stores: [store],
		})

		expect(found).toEqual([
			{ executable: envFile, engine: 'edge' },
			{ executable: pathFile, engine: 'chrome' },
			{ executable: link, engine: 'chromium' },
		])
	})

	it('dedupes a candidate reachable via two sources by normalized path', () => {
		const dir = createTempDir()
		const shared = join(dir, 'chrome')
		writeFileSync(shared, '')

		const found = findSystemBrowsers({
			env: { PLAYWRIGHT_EXECUTABLE_PATH: shared },
			paths: [shared],
			names: [],
			stores: [],
		})

		expect(found).toEqual([{ executable: shared, engine: 'chrome' }])
	})

	it('narrows results to the requested engine', () => {
		const dir = createTempDir()
		const edgeFile = join(dir, 'msedge')
		const chromeFile = join(dir, 'google-chrome')
		writeFileSync(edgeFile, '')
		writeFileSync(chromeFile, '')

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
		const dir = createTempDir()
		const chromeFile = join(dir, 'google-chrome')
		writeFileSync(chromeFile, '')

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

describe('waitForCdpReady', () => {
	it('resolves the WebSocket debugger URL once the endpoint is ready', async () => {
		server = await createCdpTestServer()
		const url = await waitForCdpReady(server.port, 2000)
		expect(url).toBe(server.wsUrl)
	})

	it('throws when the endpoint never becomes ready before the timeout', async () => {
		await expect(waitForCdpReady(19_992, 100)).rejects.toThrow(/did not become ready/)
	})

	it('respects the deadline against a hanging endpoint', async () => {
		server = await createCdpTestServer()
		server.hang(true)
		const start = Date.now()
		await expect(waitForCdpReady(server.port, 150)).rejects.toThrow(/did not become ready/)
		expect(Date.now() - start).toBeLessThan(1000)
	})

	it('honors an explicit host', async () => {
		server = await createCdpTestServer()
		const url = await waitForCdpReady(server.port, 2000, '127.0.0.1')
		expect(url).toBe(server.wsUrl)
	})
})

describe('fetchCdpTargets', () => {
	it('returns normalized targets from /json/list', async () => {
		server = await createCdpTestServer()
		server.list([{ id: 't1', type: 'page', title: 'Home', url: 'https://example.com' }])

		const targets = await fetchCdpTargets(server.port, 2000)

		expect(targets).toEqual([{ id: 't1', type: 'page', title: 'Home', url: 'https://example.com' }])
	})

	it('returns an empty array when the endpoint is unreachable', async () => {
		const targets = await fetchCdpTargets(19_993, 100)
		expect(targets).toEqual([])
	})

	it('accepts targets with empty title/url', async () => {
		server = await createCdpTestServer()
		server.list([{ id: 't2', type: 'page', title: '', url: '' }])

		const targets = await fetchCdpTargets(server.port, 2000)

		expect(targets).toEqual([{ id: 't2', type: 'page', title: '', url: '' }])
	})

	it('honors an explicit host', async () => {
		server = await createCdpTestServer()
		server.list([{ id: 't3', type: 'page', title: '', url: '' }])

		const targets = await fetchCdpTargets(server.port, 2000, '127.0.0.1')

		expect(targets).toEqual([{ id: 't3', type: 'page', title: '', url: '' }])
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
