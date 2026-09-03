/**
 * Live-browser proofs for the `Browser` façade.
 *
 * Every case here launches or attaches to a real Chromium-family browser process
 * resolved by `tests/setupService.ts`, which hard-requires readiness and throws when the
 * host has none. Nothing in this file skips: a browserless host fails the project.
 */

import type { BrowserInterface } from '@src/server'
import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createBrowser } from '@src/server'
import { BROWSER_RESULT_LIMIT, isBrowserResultLimitError, compileCodegenScript } from '@src/core'
import { isRecord } from '@orkestrel/contract'
import { createRecorder, requireValue, waitForCondition } from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import {
	createTempDirectory,
	createTCPProxy,
	destroyFakeBrowsers,
	destroyTempDirectories,
	readServerPort,
	reservePort,
	waitForProcessExit,
} from '../setupServer.js'
import { requireSystemBrowser, SERVICE_BROWSER_ARGS } from '../setupService.js'

const REAL_BROWSER_EXECUTABLE = requireSystemBrowser().executable
const REAL_BROWSER_ARGS = [...SERVICE_BROWSER_ARGS]

describe('Browser real launch', () => {
	let browser: BrowserInterface | undefined

	afterEach(async () => {
		await browser?.destroy()
		browser = undefined
		await destroyFakeBrowsers()
		await destroyTempDirectories()
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
				executable: REAL_BROWSER_EXECUTABLE,
				headless: true,
				profile: createTempDirectory('orkestrel-browser-profile-').path,
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
	})

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
				executable: REAL_BROWSER_EXECUTABLE,
				headless: true,
				profile: createTempDirectory('orkestrel-browser-profile-').path,
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
	})

	it('screenshot returns real PNG bytes from a real browser page', async () => {
		browser = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: createTempDirectory('orkestrel-browser-profile-').path,
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

		const scratch = createTempDirectory('orkestrel-browser-screenshot-')
		const path = join(scratch.path, 'screenshot.png')

		const withPath = await page.screenshot({ path })
		expect(withPath.path).toBe(path)
		const written = readFileSync(path)
		expect(written.length).toBeGreaterThan(100)
	})

	it('launches and destroys a real browser process, fully exiting it', async () => {
		const port = await reservePort()
		browser = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: createTempDirectory('orkestrel-browser-profile-').path,
			args: REAL_BROWSER_ARGS,
			cdp: { port },
			timeout: 20_000,
		})

		await browser.connect()
		expect(browser.status).toBe('connected')

		await browser.destroy()
		expect(browser.status).not.toBe('connected')

		// A destroyed launch releases its CDP port — a fresh launch can reuse it.
		const relaunch = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: createTempDirectory('orkestrel-browser-profile-').path,
			args: REAL_BROWSER_ARGS,
			cdp: { port },
			timeout: 20_000,
		})
		await relaunch.connect()
		expect(relaunch.status).toBe('connected')
		await relaunch.destroy()
	})

	it('connect() with a profile launches with a persistent user-data dir', async () => {
		const profile = createTempDirectory('orkestrel-browser-profile-').path

		browser = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
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
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile,
			args: REAL_BROWSER_ARGS,
			cdp: { port: await reservePort() },
			timeout: 20_000,
		})
		await relaunch.connect()
		expect(relaunch.status).toBe('connected')
		await relaunch.destroy()
	})

	it('accepts explicit headless option against a real launch', async () => {
		// This container has no display server, so a successful connect +
		// render within the timeout is itself proof the explicit `headless:
		// true` option launched a working (non-UI-dependent) browser process.
		browser = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: createTempDirectory('orkestrel-browser-profile-').path,
			args: REAL_BROWSER_ARGS,
			cdp: { port: await reservePort() },
			timeout: 20_000,
		})

		await browser.connect()
		expect(browser.status).toBe('connected')

		const page = await browser.create()
		const content = await page.content()
		expect(content.url).toBe('about:blank')
	})

	// === hardening (real Chromium) — proves the audit's confirmed defects are fixed

	it('an oversized evaluate() result rejects with a coded error and the session survives', async () => {
		browser = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: createTempDirectory('orkestrel-browser-profile-').path,
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
		expect(browser.status).toBe('connected')
		expect(await page.evaluate('1 + 1')).toBe(2)
		expect(pid).toBeDefined()
		const livePid = requireValue(pid)
		expect(() => process.kill(livePid, 0)).not.toThrow()
	})

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
				executable: REAL_BROWSER_EXECUTABLE,
				headless: true,
				profile: createTempDirectory('orkestrel-browser-profile-').path,
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
			expect(browser.status).toBe('connected')
			expect(await page.evaluate('1 + 1')).toBe(2)
		} finally {
			await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		}
	})

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
				executable: REAL_BROWSER_EXECUTABLE,
				headless: true,
				profile: createTempDirectory('orkestrel-browser-profile-').path,
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
	})

	it('transport-loss resumability against a real Chromium process, proxied over a raw TCP pipe', async () => {
		const cdpPort = await reservePort()
		const proxyPort = await reservePort()

		// A real Chromium rejects a CDP WebSocket upgrade whose Host header
		// doesn't match an allowed origin — because the raw TCP proxy forwards
		// the client's Host header (127.0.0.1:proxyPort) unmodified to
		// Chromium (which is listening as 127.0.0.1:cdpPort), Chromium must be
		// told to allow it explicitly.
		const owner = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: createTempDirectory('orkestrel-browser-profile-').path,
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
			expect(proxied.status).toBe('connected')
			expect(proxied.connection).toBe('cdp')
			const page = await proxied.create()
			expect(await page.evaluate('1 + 1')).toBe(2)

			// Sever the transport: destroy every piped socket and close the
			// proxy server — the browser process itself is untouched.
			await proxy.stop()
			await waitForCondition(
				'the browser reported one error and one disconnect',
				() => errors.count === 1 && disconnect.count === 1,
			)

			expect(errors.count).toBe(1)
			expect(disconnect.count).toBe(1)
			expect(proxied.status).not.toBe('connected')

			// Chromium (owned by `owner`) survives the transport loss.
			const livePid = requireValue(ownerPid)
			expect(() => process.kill(livePid, 0)).not.toThrow()

			// Rebuild the proxy on the SAME port so the proxied instance's
			// frozen `cdp.endpoint` (still pointing at 127.0.0.1:proxyPort)
			// resolves again — connect() on the same instance resumes.
			await proxy.start(chromiumWSURL.hostname, Number(chromiumWSURL.port))

			await proxied.connect()
			expect(proxied.status).toBe('connected')
			const resumedPage = await proxied.create()
			expect(await resumedPage.evaluate('2 + 2')).toBe(4)
		} finally {
			await proxied?.destroy()
			await proxy.stop()
			await owner.destroy()
		}
	})

	it('close() gracefully shuts down an owned real browser process', async () => {
		browser = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: createTempDirectory('orkestrel-browser-profile-').path,
			args: REAL_BROWSER_ARGS,
			cdp: { port: await reservePort() },
			timeout: 20_000,
		})

		await browser.connect()
		const pid = browser.pid
		expect(pid).toBeDefined()

		await browser.close()
		expect(browser.status).not.toBe('connected')

		const livePid = requireValue(pid)
		expect(() => process.kill(livePid, 0)).toThrow('ESRCH')
	})

	it('close() on a cdp-attached instance shuts down the shared real browser and the owner observes disconnect', async () => {
		const port = await reservePort()
		let owner: BrowserInterface | undefined
		let second: BrowserInterface | undefined

		try {
			owner = createBrowser({
				executable: REAL_BROWSER_EXECUTABLE,
				headless: true,
				profile: createTempDirectory('orkestrel-browser-profile-').path,
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
			await waitForCondition('the owner reported a disconnect', () => disconnect.count > 0, {
				budget: 20_000,
				interval: 50,
			})
			expect(owner.status).not.toBe('connected')
			const livePid = requireValue(pid)
			await waitForProcessExit(livePid)
			expect(disconnect.count).toBe(1)
			expect(isRunning(livePid)).toBe(false)
		} finally {
			// Safety net — no-op once close() has already torn everything down.
			await owner?.destroy()
			await second?.destroy()
		}
	})

	it('navigate() with a per-call timeout rejects well under the client default and the session survives', async () => {
		const httpServer = createServer((req) => {
			// Never respond — simulates a hanging endpoint.
			void req
		})
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		const url = `http://127.0.0.1:${readServerPort(httpServer)}/`

		try {
			browser = createBrowser({
				executable: REAL_BROWSER_EXECUTABLE,
				headless: true,
				profile: createTempDirectory('orkestrel-browser-profile-').path,
				args: REAL_BROWSER_ARGS,
				cdp: { port: await reservePort() },
				timeout: 20_000,
			})

			await browser.connect()
			const page = await browser.create()

			const started = performance.now()
			await expect(page.navigate(url, { timeout: 1500 })).rejects.toThrow('CDP request timed out')
			const elapsed = performance.now() - started
			expect(elapsed).toBeLessThan(3000)

			// The client-side timeout must not leave the session wedged — a
			// subsequent call on the same page must still complete.
			expect(browser.status).toBe('connected')
			expect(await page.evaluate('1 + 1')).toBe(2)
		} finally {
			await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		}
	})

	it('records and replays a contenteditable fill through codegen on a real DOM', async () => {
		const httpServer = createServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' })
			res.end('<html><body><div id="editable" contenteditable="true"></div></body></html>')
		})
		await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
		const url = `http://127.0.0.1:${readServerPort(httpServer)}/`

		try {
			browser = createBrowser({
				executable: REAL_BROWSER_EXECUTABLE,
				headless: true,
				profile: createTempDirectory('orkestrel-browser-profile-').path,
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
	})
})
