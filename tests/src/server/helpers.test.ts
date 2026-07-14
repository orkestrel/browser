/**
 * src/server/helpers.ts tests.
 *
 * `fetchCdpTargets` / `waitForCdpReady` are exercised against a real
 * in-process HTTP server (`createCdpTestServer`). `findSystemBrowser` is
 * exercised as-is — this container ships no Chrome/Chromium/Edge, so the
 * absent-browser path is the real, natural behavior (no mocking).
 * `launchBrowserProcess` argument construction is verified by spawning the
 * real Node binary as a stand-in executable and reading `ChildProcess.spawnargs`
 * — the exact argv passed to the OS — never a mock of `child_process`.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { findSystemBrowser, launchBrowserProcess, waitForCdpReady, fetchCdpTargets } from '@src/server'
import { createCdpTestServer } from '../../setupServer.js'
import type { CDPTestServerInterface } from '../../setupServer.js'

let server: CDPTestServerInterface | undefined

afterEach(async () => {
	await server?.close()
	server = undefined
})

describe('findSystemBrowser', () => {
	it('returns undefined when no known browser executable is installed', () => {
		// This test container ships no Chrome/Chromium/Edge — the real,
		// unmocked absent-browser path.
		expect(findSystemBrowser()).toBeUndefined()
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
})

describe('launchBrowserProcess', () => {
	// Uses the real Node binary as a stand-in executable — a real
	// `child_process.spawn()` call, not a mock. `ChildProcess.spawnargs`
	// reports the exact argv passed to the OS, so argument construction is
	// verified without depending on the child staying alive.

	it('includes the debugging-port and headless flags', () => {
		const port = 19_994
		const process = launchBrowserProcess(globalThis.process.execPath, port, true, undefined, ['--extra-flag'])
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
		const process = launchBrowserProcess(globalThis.process.execPath, 19_996, false, '/tmp/test-profile')
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
