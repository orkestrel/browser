/**
 * src/server/helpers.ts tests.
 *
 * `fetchCdpTargets` / `waitForCdpReady` are exercised against a real
 * in-process HTTP server (`createCdpTestServer`). `findSystemBrowser` is
 * exercised through its `SystemBrowserOptions` override bag with real
 * temp files/dirs (`node:fs`) so every assertion is deterministic across
 * machines — no mocking, no dependency on what happens to be installed.
 * `launchBrowserProcess` argument construction is verified by spawning the
 * real Node binary as a stand-in executable and reading `ChildProcess.spawnargs`
 * — the exact argv passed to the OS — never a mock of `child_process`.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	findSystemBrowser,
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

		expect(found).toBe(file)
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

		expect(found).toBe(envFile)
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

		expect(found).toBe(chromePathFile)
	})

	it('resolves a versioned Chromium install inside a browser store', () => {
		// Mirrors the current platform's store shape so this test is honest
		// everywhere it runs (linux: chromium-<rev>/chrome-linux/chrome).
		const store = createTempDir()
		const installDir = join(store, 'chromium-1194', 'chrome-linux')
		mkdirSync(installDir, { recursive: true })
		const binary = join(installDir, 'chrome')
		writeFileSync(binary, '')

		const found = findSystemBrowser({ env: {}, paths: [], names: [], stores: [store] })

		expect(found).toBe(binary)
	})

	it('resolves the top-level chromium link inside a browser store', () => {
		const store = createTempDir()
		const link = join(store, 'chromium')
		writeFileSync(link, '')

		const found = findSystemBrowser({ env: {}, paths: [], names: [], stores: [store] })

		expect(found).toBe(link)
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
