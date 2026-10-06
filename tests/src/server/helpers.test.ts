/**
 * src/server/helpers.ts tests.
 *
 * `fetchCDPTargets` is exercised against a real
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
import { PassThrough } from 'node:stream'
import { join, dirname, delimiter } from 'node:path'
import { requireValue } from '@orkestrel/test'
import { createScratch, readErrorCode } from '@orkestrel/test/server'
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
	readBrowserEndpoint,
	fetchCDPTargets,
	formatBrowserLockEntry,
	parseBrowserLockEntry,
	probeProcess,
	parseBrowserProfileRecord,
	parseBrowserViewport,
	describeBrowserServerLoss,
	BROWSER_SERVER_CRASH,
	BROWSER_SERVER_LAUNCH,
	BROWSER_SERVER_UNAVAILABLE,
	BROWSER_SERVER_UNRESOLVED,
} from '@src/server'
import { BrowserConnectionError, isBrowserConnectionError } from '@src/core'
import { createCDPTestServer, readExitedProcessId } from '../../setupServer.js'
import type { CDPTestServerInterface } from '../../setupServer.js'

let server: CDPTestServerInterface | undefined

describe('parseBrowserViewport', () => {
	it('parses positive integer dimensions', () => {
		expect(parseBrowserViewport('1280x720')).toEqual({ width: 1280, height: 720 })
		expect(parseBrowserViewport('1x1')).toEqual({ width: 1, height: 1 })
	})
	it('leaves an omitted or empty value unset', () => {
		expect(parseBrowserViewport(undefined)).toBeUndefined()
		expect(parseBrowserViewport('')).toBeUndefined()
	})
	it.each([
		'0x720',
		'-1x2',
		'1.5x2',
		'1280',
		'1280x',
		'widexhigh',
		'2x0',
		'2x-1',
		'2x1.5',
		'1280X720',
		' 1280x720',
		'1280x720 ',
		'1280x720\n',
		'1280x720x1',
		'1e3x720',
		'Infinityx720',
		'9007199254740992x720',
		'1280x9007199254740992',
	])('refuses %j', (value) => {
		expect(parseBrowserViewport(value)).toBeUndefined()
	})
})

describe('eager U4 profile and loss helpers', () => {
	it('treats a runtime-proven EPERM process as present', (context) => {
		// Init and the Windows system process are candidates only; signal zero decides applicability.
		const denied = [1, 4].find((pid) => {
			try {
				process.kill(pid, 0)
				return false
			} catch (error) {
				return readErrorCode(error) === 'EPERM'
			}
		})
		context.skip(
			denied === undefined,
			'NOT-EVIDENCED: signal zero on pid 1 and pid 4 produced no EPERM',
		)
		expect(probeProcess(requireValue(denied, 'runtime EPERM pid'))).toBe(true)
	})
	it('keeps recovery guidance on unresolved outcomes alone', () => {
		const crash = describeBrowserServerLoss(BROWSER_SERVER_CRASH, new Error('Browser exited'))
		expect(crash).toContain('Lost the page')
		expect(crash).not.toContain('The next call')
		expect(
			describeBrowserServerLoss(BROWSER_SERVER_UNRESOLVED, new Error('Browser exited')),
		).toContain('The next call acquires a browser that starts at about:blank')
	})
	it('renders a cause with one terminal period', () => {
		expect(
			describeBrowserServerLoss(
				BROWSER_SERVER_UNAVAILABLE,
				new Error('No Chromium browser found.'),
			),
		).toBe('BROWSER_SERVER_UNAVAILABLE: No Chromium browser found.')
	})
	it('distinguishes the live process from an exited child', async () => {
		expect(probeProcess(process.pid)).toBe(true)
		expect(probeProcess(await readExitedProcessId())).toBe(false)
	})

	it('round-trips a profile and refuses malformed or remote records', () => {
		const record = { pid: process.pid, endpoint: 'ws://127.0.0.1:9222/devtools/browser/session' }
		expect(parseBrowserProfileRecord(JSON.stringify(record))).toEqual(record)
		expect(parseBrowserProfileRecord('broken')).toBeUndefined()
		expect(parseBrowserProfileRecord('null')).toBeUndefined()
		expect(parseBrowserProfileRecord(JSON.stringify({ pid: record.pid }))).toBeUndefined()
		expect(parseBrowserProfileRecord(JSON.stringify({ endpoint: record.endpoint }))).toBeUndefined()
		for (const pid of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '123', null])
			expect(parseBrowserProfileRecord(JSON.stringify({ ...record, pid }))).toBeUndefined()
		for (const endpoint of [
			'ws://localhost:9222/devtools/browser/session',
			'ws://192.0.2.1:9222/devtools/browser/session',
			'ws://127.0.0.1:9222/cdp',
			'ws://127.0.0.1:9222/devtools/browser/',
			'wss://127.0.0.1:9222/devtools/browser/session',
			'ws://127.0.0.1:0/devtools/browser/session',
			'ws://127.0.0.1:65536/devtools/browser/session',
			'ws://127.0.0.1/devtools/browser/session',
			'ws://127.0.0.1:9222/devtools/browser/session?redirect=remote',
		])
			expect(parseBrowserProfileRecord(JSON.stringify({ ...record, endpoint }))).toBeUndefined()
	})

	it('codes loss messages and names the unknown outcome, lost state, and conditional recovery', () => {
		const cause = new BrowserConnectionError('Browser process did not exit after SIGKILL', {
			pid: 4242,
		})
		for (const code of [
			BROWSER_SERVER_CRASH,
			BROWSER_SERVER_LAUNCH,
			BROWSER_SERVER_UNAVAILABLE,
			BROWSER_SERVER_UNRESOLVED,
		]) {
			const text = describeBrowserServerLoss(code, cause, 'https://example.test/cart')
			expect(text.startsWith(`${code}:`)).toBe(true)
			expect(text).toContain('4242')
			expect(text).toContain(cause.message)
		}
		const text = describeBrowserServerLoss(
			BROWSER_SERVER_UNRESOLVED,
			cause,
			'https://example.test/cart',
		)
		expect(text).toContain('The outcome is unknown')
		expect(text).toContain('Browse did not repeat the call')
		expect(text).toContain(
			'The next call acquires a browser that starts at about:blank, or answers BROWSER_SERVER_UNAVAILABLE when none can serve',
		)
		for (const state of [
			'https://example.test/cart',
			'tabs',
			'every element reference',
			'retained reading',
			'dialogs',
			'holds',
			'unsaved recording',
			'active replay',
			"isolated context's cookies",
		])
			expect(text).toContain(state)
		expect(describeBrowserServerLoss(BROWSER_SERVER_CRASH, undefined)).toContain(
			'Browser session lost',
		)
		expect(describeBrowserServerLoss(BROWSER_SERVER_UNAVAILABLE, 'endpoint refused')).toContain(
			'endpoint refused',
		)
	})
})

describe('formatBrowserLockEntry', () => {
	it('joins the holder pid and acquisition token in the persisted format', () => {
		expect(formatBrowserLockEntry(123, '11111111-1111-4111-8111-111111111111')).toBe(
			'123-11111111-1111-4111-8111-111111111111',
		)
	})
})

describe('parseBrowserLockEntry', () => {
	it('reads a positive safe holder pid only from a complete lowercase UUID entry', () => {
		expect(parseBrowserLockEntry('123-11111111-1111-4111-8111-111111111111')).toBe(123)
		expect(
			parseBrowserLockEntry(formatBrowserLockEntry(1, 'abcdef12-abcd-abcd-abcd-abcdef123456')),
		).toBe(1)
		expect(
			parseBrowserLockEntry(
				formatBrowserLockEntry(Number.MAX_SAFE_INTEGER, '11111111-1111-4111-8111-111111111111'),
			),
		).toBe(Number.MAX_SAFE_INTEGER)
		expect(parseBrowserLockEntry('')).toBeUndefined()
		expect(parseBrowserLockEntry('123')).toBeUndefined()
		expect(parseBrowserLockEntry('123-invalid')).toBeUndefined()
		expect(parseBrowserLockEntry('0123-11111111-1111-4111-8111-111111111111')).toBeUndefined()
		expect(
			parseBrowserLockEntry(formatBrowserLockEntry(0, '11111111-1111-4111-8111-111111111111')),
		).toBeUndefined()
		expect(
			parseBrowserLockEntry(formatBrowserLockEntry(-1, '11111111-1111-4111-8111-111111111111')),
		).toBeUndefined()
		expect(
			parseBrowserLockEntry(formatBrowserLockEntry(1.5, '11111111-1111-4111-8111-111111111111')),
		).toBeUndefined()
		expect(
			parseBrowserLockEntry(
				formatBrowserLockEntry(Number.MAX_SAFE_INTEGER + 1, '11111111-1111-4111-8111-111111111111'),
			),
		).toBeUndefined()
		expect(
			parseBrowserLockEntry(formatBrowserLockEntry(123, 'ABCDEF12-abcd-abcd-abcd-abcdef123456')),
		).toBeUndefined()
		expect(parseBrowserLockEntry('123-11111111-1111-4111-8111-111111111111/entry')).toBeUndefined()
	})
})
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

describe('readBrowserEndpoint', () => {
	const line = 'DevTools listening on ws://127.0.0.1:41234/devtools/browser/ID'

	it('resolves the endpoint a complete line names', async () => {
		const stream = new PassThrough()
		const pending = readBrowserEndpoint(stream, new AbortController().signal)
		stream.write(`[noise] starting\n${line}\n`)
		expect(await pending).toBe('ws://127.0.0.1:41234/devtools/browser/ID')
	})

	it('resolves a line split across two chunks', async () => {
		const stream = new PassThrough()
		const pending = readBrowserEndpoint(stream, new AbortController().signal)
		stream.write(line.slice(0, 20))
		stream.write(`${line.slice(20)}\n`)
		expect(await pending).toBe('ws://127.0.0.1:41234/devtools/browser/ID')
	})

	it('resolves a line ending with a carriage return and a line feed', async () => {
		const stream = new PassThrough()
		const pending = readBrowserEndpoint(stream, new AbortController().signal)
		stream.write(`${line}\r\n`)
		expect(await pending).toBe('ws://127.0.0.1:41234/devtools/browser/ID')
	})

	it('keeps draining the stream after it resolves', async () => {
		const stream = new PassThrough({ highWaterMark: 16 })
		const pending = readBrowserEndpoint(stream, new AbortController().signal)
		stream.write(`${line}\n`)
		await pending
		const flooded = new Promise<void>((resolve) =>
			stream.write('x'.repeat(1024 * 1024), () => resolve()),
		)
		await flooded
		expect(stream.readableLength).toBe(0)
	})

	it('rejects with the readiness failure when the stream ends without the line', async () => {
		const stream = new PassThrough()
		const pending = readBrowserEndpoint(stream, new AbortController().signal)
		stream.end('[noise] starting\n')
		await expect(pending).rejects.toThrow(/before reporting a CDP endpoint/)
		await expect(pending).rejects.toSatisfy(isBrowserConnectionError)
	})

	it('rejects with the reason when the signal aborts', async () => {
		const stream = new PassThrough()
		const controller = new AbortController()
		const pending = readBrowserEndpoint(stream, controller.signal)
		controller.abort(new Error('stopped by the caller'))
		await expect(pending).rejects.toThrow('stopped by the caller')
	})

	it('rejects with the reason when the signal is already aborted', async () => {
		const stream = new PassThrough()
		await expect(
			readBrowserEndpoint(stream, AbortSignal.abort(new Error('early'))),
		).rejects.toThrow('early')
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
			expect(process.spawnargs).toContain('--disable-sync')
			expect(process.spawnargs).toContain('--disable-features=msImplicitSignin')
			expect(process.spawnargs).toContain('--extra-flag')
		} finally {
			process.kill()
		}
	})

	it('passes port 0 and pipes standard error when no port is given', () => {
		const process = launchBrowserProcess(globalThis.process.execPath, undefined, true)
		try {
			expect(process.spawnargs).toContain('--remote-debugging-port=0')
			expect(process.stderr).not.toBeNull()
			expect(process.stdout).toBeNull()
		} finally {
			process.kill()
		}
	})

	it('merges caller and library disabled features into one switch', () => {
		const extra = Object.freeze(['--no-sandbox', '--disable-features=CallerFeature'])
		const process = launchBrowserProcess(
			globalThis.process.execPath,
			undefined,
			true,
			undefined,
			extra,
		)
		try {
			expect(process.spawnargs.filter((arg) => arg.startsWith('--disable-features='))).toEqual([
				'--disable-features=CallerFeature,msImplicitSignin',
			])
			expect(process.spawnargs).toContain('--no-sandbox')
			expect(process.spawnargs).toContain('--headless=new')
			expect(extra).toEqual(['--no-sandbox', '--disable-features=CallerFeature'])
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

	it('combines repeated disabled-feature switches and ignores empty and duplicate entries', () => {
		const process = launchBrowserProcess(globalThis.process.execPath, undefined, false, undefined, [
			'launch-script.js',
			'--disable-features=CallerFeature, msImplicitSignin,,CallerFeature',
			'--disable-features=',
			'--disable-features',
			'--disable-features=AnotherFeature',
			'--enable-features=EnabledFeature',
		])
		try {
			expect(process.spawnargs[1]).toBe('launch-script.js')
			expect(process.spawnargs.filter((arg) => arg.startsWith('--disable-features'))).toEqual([
				'--disable-features=CallerFeature,msImplicitSignin,AnotherFeature',
			])
			expect(process.spawnargs).toContain('--enable-features=EnabledFeature')
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
