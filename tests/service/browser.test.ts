/**
 * Live-browser proofs for the `Browser` façade.
 *
 * Every case here launches or attaches to a real Chromium-family browser process
 * resolved by `tests/setupService.ts`, which hard-requires readiness and throws when the
 * host has none, so a browserless host fails the project. The one skip is the live `WebMCP`
 * case's conditional context skip, taken only after it asserts the protocol reading its
 * reason cites.
 */

import type { BrowserInterface } from '@src/server'
import type {
	BrowserPageElementInterface,
	BrowserPageInterface,
	BrowserPoint,
	BrowserReadResult,
	CDPClientInterface,
} from '@src/core'
import type { FixtureServerInterface } from '../setupServer.js'
import { describe, it, expect, afterAll, afterEach, beforeAll } from 'vitest'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createBrowser, createCDPTransport } from '@src/server'
import {
	BROWSER_RESULT_LIMIT,
	BROWSER_REGISTRY_ABSENT_CODE,
	createCDPClient,
	isBrowserError,
	isBrowserResultLimitError,
	readEvaluationResult,
} from '@src/core'
import { isRecord, isString } from '@orkestrel/contract'
import {
	createRecorder,
	createTeardown,
	requireValue,
	retryUntil,
	waitForCondition,
} from '@orkestrel/test'
import { isRunning } from '@orkestrel/test/server'
import {
	createFixtureServer,
	createTempDirectory,
	createTCPProxy,
	destroyFakeBrowsers,
	destroyTempDirectories,
	FIXTURE_LATE_TEXT,
	readServerPort,
	reservePort,
	waitForProcessExit,
} from '../setupServer.js'
import {
	extractOutlineReferences,
	parseProtocolDomains,
	REGISTRY_ABSENT_REASON,
	requireCacheRestore,
	requireSystemBrowser,
	SERVICE_BROWSER_ARGS,
	SERVICE_REGISTRY_ARGS,
} from '../setupService.js'
import { WAIT_EXIT_HTML } from '../setup.js'

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
			const reading = await page.read()

			expect(title).toBe('Real Launch')
			expect(reading.text().text).toContain('Hello')
		} finally {
			await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		}
	})

	it('drives elements, frames, routes, snapshots, accessibility, and PDF in a real browser', async () => {
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

			const saves = await page.elements.find({ role: 'button', name: 'Save' })
			expect(saves).toHaveLength(1)
			await saves[0]?.click()
			expect(await page.evaluate('document.body.dataset.clicked')).toBe('yes')

			const frame = await page.frame('checkout')
			expect(frame).toBeDefined()
			if (frame === undefined) throw new Error('Named frame was not attached')
			const emails = await page.elements.find({ role: 'textbox', name: 'Email' })
			expect(emails).toHaveLength(1)
			await emails[0]?.fill('ada@example.com')
			expect(await frame.evaluate("document.querySelector('input').value")).toBe('ada@example.com')

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
		const reading = await page.read()
		expect(reading.url).toBe('about:blank')
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

	it('read() on a huge DOM rejects with a result-limit error and keeps the session alive', async () => {
		const httpServer = createServer((req, res) => {
			res.writeHead(200, { 'content-type': 'text/html' })
			if (req.url === '/small') {
				res.end('<html><body><p>Small document</p></body></html>')
				return
			}
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

			await expect(page.read()).rejects.toSatisfy(isBrowserResultLimitError)
			expect(browser.status).toBe('connected')
			expect(await page.evaluate('1 + 1')).toBe(2)

			await page.navigate(`${url}small`)
			expect((await page.read()).html).not.toBe('')
		} finally {
			await new Promise<void>((resolve) => httpServer.close(() => resolve()))
		}
	})

	it('reattaching over CDP reports the correct page url immediately, before navigate() or read()', async () => {
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
				isRecord(versionJson) && isString(versionJson['webSocketDebuggerUrl'])
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
})

describe('Browser proofs against the fixture pages', () => {
	const teardown = createTeardown()
	const opened: BrowserPageInterface[] = []
	let fixtures: FixtureServerInterface
	let browser: BrowserInterface
	let registry: BrowserInterface
	let port: number

	// Each resource registers its release as soon as it exists, so a later acquisition that
	// rejects still releases the earlier ones, and no release reads an unassigned binding.
	beforeAll(async () => {
		const server = await createFixtureServer()
		teardown.add(() => server.destroy())
		fixtures = server

		const profile = createTempDirectory('orkestrel-browser-profile-')
		teardown.add(() => profile.destroy())
		port = await reservePort()
		const launched = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: profile.path,
			args: [...REAL_BROWSER_ARGS, '--site-per-process'],
			cdp: { port },
			timeout: 20_000,
		})
		teardown.add(() => launched.destroy())
		await launched.connect()
		browser = launched

		const flaggedProfile = createTempDirectory('orkestrel-browser-profile-')
		teardown.add(() => flaggedProfile.destroy())
		const flagged = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: flaggedProfile.path,
			args: [...REAL_BROWSER_ARGS, ...SERVICE_REGISTRY_ARGS],
			cdp: { port: await reservePort() },
			timeout: 20_000,
		})
		teardown.add(() => flagged.destroy())
		await flagged.connect()
		registry = flagged
	})

	afterEach(async () => {
		for (const page of opened.splice(0)) await page.close().catch(() => undefined)
	})

	afterAll(async () => {
		await teardown.destroy()
	})

	describe('an out-of-process frame', () => {
		let page: BrowserPageInterface
		let child: CDPClientInterface
		let session: string
		let local: BrowserPoint
		let content: BrowserPoint

		// Establishes, outside every expected-failure body, that `--site-per-process` put the
		// `localhost` document in its own target with its own session, and reads the framed
		// button's centre through a second protocol connection that does not depend on the page's
		// frame tracking.
		beforeAll(async () => {
			const outer = await browser.create()
			teardown.add(() => outer.close())
			page = outer
			const attached = createRecorder<[Readonly<Record<string, unknown>>]>()
			await page.subscribe('Target.attachedToTarget', attached.handler)
			await page.navigate(fixtures.url('/frame/outer'))
			await waitForCondition(
				'precondition: the localhost frame attached as its own iframe target',
				() =>
					attached.calls.some(
						([params]) =>
							isRecord(params['targetInfo']) && params['targetInfo']['type'] === 'iframe',
					),
				{ budget: 10_000, interval: 20 },
			)
			const event = requireValue(
				attached.calls.find(
					([params]) => isRecord(params['targetInfo']) && params['targetInfo']['type'] === 'iframe',
				),
			)[0]
			const target = isRecord(event['targetInfo']) ? event['targetInfo']['targetId'] : undefined
			if (!isString(event['sessionId']) || !isString(target) || target === page.target)
				throw new Error(
					'Precondition failed: the framed document has no session of its own; launch Chromium with --site-per-process.',
				)

			const version: unknown = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
			const endpoint = isRecord(version) ? version['webSocketDebuggerUrl'] : undefined
			if (!isString(endpoint))
				throw new Error('Precondition failed: Chromium reported no debugger URL.')
			const client = createCDPClient({
				transport: createCDPTransport({ url: endpoint }),
				timeout: 10_000,
			})
			teardown.add(() => client.close())
			await client.connect()
			child = client
			const attachment = await client.send('Target.attachToTarget', {
				targetId: target,
				flatten: true,
			})
			const raw = isRecord(attachment) ? attachment['sessionId'] : undefined
			if (!isString(raw) || raw === event['sessionId'])
				throw new Error(
					'Precondition failed: the second connection opened no session of its own on the frame.',
				)
			session = raw
			await waitForCondition(
				'precondition: the framed Pay button rendered',
				async () =>
					readEvaluationResult(
						await client.send(
							'Runtime.evaluate',
							{ expression: "document.getElementById('pay') !== null", returnByValue: true },
							{ session },
						),
					) === true,
				{ budget: 10_000, interval: 20 },
			)
			const origin = readEvaluationResult(
				await client.send(
					'Runtime.evaluate',
					{ expression: 'location.origin', returnByValue: true },
					{ session },
				),
			)
			if (origin !== `http://localhost:${fixtures.port}`)
				throw new Error(`Precondition failed: the framed document's origin is ${String(origin)}.`)
			local = {
				x: Number(
					readEvaluationResult(
						await client.send(
							'Runtime.evaluate',
							{
								expression:
									"(() => { const box = document.getElementById('pay').getBoundingClientRect(); return box.x + box.width / 2 })()",
								returnByValue: true,
							},
							{ session },
						),
					),
				),
				y: Number(
					readEvaluationResult(
						await client.send(
							'Runtime.evaluate',
							{
								expression:
									"(() => { const box = document.getElementById('pay').getBoundingClientRect(); return box.y + box.height / 2 })()",
								returnByValue: true,
							},
							{ session },
						),
					),
				),
			}
			content = {
				x: Number(
					await page.evaluate(
						"(() => { const frame = document.querySelector('iframe'); return frame.getBoundingClientRect().x + frame.clientLeft })()",
					),
				),
				y: Number(
					await page.evaluate(
						"(() => { const frame = document.querySelector('iframe'); return frame.getBoundingClientRect().y + frame.clientTop })()",
					),
				),
			}
		})

		it('clicks an out-of-process frame button through page.elements into the frame document, hit-testing it on the frame session and offsetting it by the content box, and leaves the outer decoy unclicked', async () => {
			const [pay] = await page.elements.find({ role: 'button', name: 'Pay' })
			const button = requireValue(pay)
			expect((await button.quad()).center).toStrictEqual({
				x: content.x + local.x,
				y: content.y + local.y,
			})
			await button.click()
			expect(
				readEvaluationResult(
					await child.send(
						'Runtime.evaluate',
						{ expression: 'document.body.dataset.received', returnByValue: true },
						{ session },
					),
				),
			).toBe('pay:true')
			expect(await page.evaluate('document.body.dataset.decoy')).toBeUndefined()
		})

		it('lands the raw frame-local point on the outer decoy, not in the frame (control for the frame click)', async () => {
			const received = readEvaluationResult(
				await child.send(
					'Runtime.evaluate',
					{ expression: 'document.body.dataset.received', returnByValue: true },
					{ session },
				),
			)
			await page.mouse.click(local)
			expect(await page.evaluate('document.body.dataset.decoy')).toBe('decoy:true')
			expect(
				readEvaluationResult(
					await child.send(
						'Runtime.evaluate',
						{ expression: 'document.body.dataset.received', returnByValue: true },
						{ session },
					),
				),
			).toBe(received)
		})

		it('lists the out-of-process frame at its document URL', async () => {
			expect((await page.frames()).map((frame) => frame.url)).toStrictEqual([
				fixtures.url('/frame/outer'),
				fixtures.url('/frame/inner', 'localhost'),
			])
		})
	})

	it('refuses a click on an overlay-covered button with OCCLUDED naming the covering element (control: the uncovered button clicks)', async () => {
		const page = await browser.create({ url: fixtures.url('/overlay') })
		opened.push(page)
		const [save] = await page.elements.find({ role: 'button', name: 'Save' })
		const covered = requireValue(save)

		await expect(covered.click()).rejects.toMatchObject({
			code: 'BROWSER_ELEMENT_ERROR',
			context: { reference: covered.reference, reason: 'OCCLUDED' },
			message: `Element ${covered.reference} is covered by div#veil.`,
		})
		expect(await page.evaluate('document.body.dataset.saved')).toBeUndefined()

		const [plain] = await page.elements.find({ role: 'button', name: 'Plain' })
		await requireValue(plain).click()
		expect(await page.evaluate('document.body.dataset.plain')).toBe('yes')
	})

	it('clicks a text input, a textarea, and a select, whose hit test resolves to the control rather than its user-agent shadow node (control: a plain button clicks)', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		const [name] = await page.elements.find({ role: 'textbox', name: 'Name' })
		const [notes] = await page.elements.find({ role: 'textbox', name: 'Notes' })
		const [speed] = await page.elements.find({ role: 'combobox', name: 'Speed' })

		await requireValue(name).click()
		expect(await page.evaluate('document.activeElement.id')).toBe('name')
		await requireValue(notes).click()
		expect(await page.evaluate('document.activeElement.id')).toBe('notes')
		await requireValue(speed).click()
		expect(await page.evaluate('document.activeElement.id')).toBe('speed')

		const [submit] = await page.elements.find({ role: 'button', name: 'Submit' })
		await requireValue(submit).click()
		expect(await page.evaluate('document.body.dataset.clicks')).toBe(
			'name:true notes:true speed:true submit:true',
		)
	})

	it('clicks a button below the fold after the page scrolls to it, hit-testing in document coordinates', async () => {
		const page = await browser.create({ url: fixtures.url('/article') })
		opened.push(page)
		const viewport = Number(await page.evaluate('innerHeight'))
		const offset = Number(await page.evaluate("document.getElementById('subscribe').offsetTop"))
		expect(await page.evaluate('scrollY')).toBe(0)
		expect(offset).toBeGreaterThan(viewport)

		const [subscribe] = await page.elements.find({ role: 'button', name: 'Subscribe' })
		const button = requireValue(subscribe)
		await button.click()

		expect(await page.evaluate("document.getElementById('subscribe').dataset.clicked")).toBe('1')
		expect(Number(await page.evaluate('scrollY'))).toBeGreaterThan(0)
		expect((await button.quad()).center.y).toBeLessThan(viewport)
	})

	it('reads the article distilled against whole and reassembles it from offset and limit slices (control: a limit past the total returns one slice)', async () => {
		const page = await browser.create({ url: fixtures.url('/article') })
		opened.push(page)
		const reading = await page.read()
		const distilled = reading.text({ distill: true })
		const whole = reading.text({ distill: false })

		expect(distilled.text).toContain('Field note 40 records the river gauge')
		expect(distilled.text).not.toContain('Footer chrome nobody reads')
		expect(distilled.text).not.toContain('Overlay desk')
		expect(whole.text).toContain('Field note 40 records the river gauge')
		expect(whole.text).toContain('Footer chrome nobody reads')
		expect(whole.text).toContain('Overlay desk')
		expect(distilled.total).toBeLessThan(whole.total)

		const slices: BrowserReadResult[] = []
		for (
			let offset = 0;
			offset < distilled.total && slices.length < 100;
			offset += slices.at(-1)?.text.length ?? distilled.total
		)
			slices.push(reading.text({ distill: true, offset, limit: 500 }))
		expect(slices.length).toBeGreaterThan(1)
		expect(slices.filter((slice) => slice.text.length > 500)).toStrictEqual([])
		expect(slices.filter((slice) => slice.total !== distilled.total)).toStrictEqual([])
		expect(slices.map((slice) => slice.text).join('')).toBe(distilled.text)

		expect(reading.text({ distill: true, limit: distilled.total + 1 })).toStrictEqual({
			text: distilled.text,
			offset: 0,
			total: distilled.total,
		})
	})

	// The 300 ms bound is the guide's Contract performance requirement, held on a host running up to three
	// Chromium instances at once; a busier host can exceed it without a library defect, and the
	// 5 000 ms deadline carries the functional completion. Both instants are epoch milliseconds from
	// one system clock: the page records `performance.timeOrigin + performance.now()` at the
	// insertion, and this process reads the same sum at resolution; 2 ms covers the rounding each
	// process applies to its origin.
	it('resolves wait for text inserted 200 ms after a click within 300 ms of the insertion (control: absent text stays pending before its deadline, then rejects BROWSER_WAIT_TIMEOUT)', async () => {
		const page = await browser.create({ url: fixtures.url('/late') })
		opened.push(page)
		const [reveal] = await page.elements.find({ role: 'button', name: 'Reveal' })
		const button = requireValue(reveal)
		await page.wait('Order', { timeout: 5_000 })

		const settled = createRecorder<[]>()
		const waiting = page.wait(FIXTURE_LATE_TEXT, { timeout: 5_000 })
		void waiting.then(settled.handler, settled.handler)
		expect(
			await page.evaluate(`document.body.innerText.includes(${JSON.stringify(FIXTURE_LATE_TEXT)})`),
		).toBe(false)
		expect(settled.count).toBe(0)

		await button.click()
		await waiting
		const resolved = performance.timeOrigin + performance.now()
		const latency = resolved - Number(await page.evaluate('document.body.dataset.inserted'))
		expect(latency).toBeGreaterThanOrEqual(-2)
		expect(latency).toBeLessThan(300)

		// The checkpoint is the settlement itself: the in-page deadline starts after this process
		// reads `started`, so a wait that stays pending until its deadline settles at least 1 000 ms
		// later on any host, and a slow host only moves the settlement later. The 2 ms allowance
		// covers the two processes' monotonic clocks.
		const started = performance.now()
		await expect(page.wait('Never shown', { timeout: 1_000 })).rejects.toMatchObject({
			code: 'BROWSER_WAIT_TIMEOUT',
		})
		expect(performance.now() - started).toBeGreaterThanOrEqual(1_000 - 2)
	})

	it('item 12 P1 waits for a delayed visibility exit and an immediate control', async () => {
		const page = await browser.create({ url: fixtures.url('/late') })
		opened.push(page)
		await page.evaluate(`document.body.innerHTML = ${JSON.stringify(WAIT_EXIT_HTML)}`)
		await page.wait('Saved to drafts')
		await page.evaluate(
			'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
		)
		const options = { absent: true, timeout: 2_000 }
		const waiting = page.wait('Saved to drafts', options)
		await page.evaluate("document.getElementById('toast').classList.remove('shown')")
		const start = performance.now()
		await waiting
		expect(performance.now() - start).toBeGreaterThanOrEqual(150)
		expect(performance.now() - start).toBeLessThan(1_000)
		await page.evaluate("document.getElementById('toast').classList.add('shown')")
		await page.wait('Saved to drafts')
		const control = page.wait('Saved to drafts', options)
		await page.evaluate("document.getElementById('toast').remove()")
		await control
	})

	it('waits for removal and hiding, accepts initial absence, and times out when text stays', async () => {
		const page = await browser.create({ url: fixtures.url('/late') })
		opened.push(page)
		for (const hide of [true, false]) {
			await page.evaluate("document.body.innerHTML = '<p>Saved</p>'")
			const settled = createRecorder<[]>()
			const pending = page.wait('Saved', { absent: true, timeout: 2_000 })
			void pending.then(settled.handler, settled.handler)
			await page.evaluate(
				'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
			)
			expect(settled.count).toBe(0)
			await page.evaluate(
				hide ? "document.querySelector('p').hidden = true" : "document.querySelector('p').remove()",
			)
			await pending
		}
		await page.wait('Never present', { absent: true })
		await page.evaluate("document.body.innerHTML = '<p>Saved</p>'")
		await expect(page.wait('Saved', { absent: true, timeout: 100 })).rejects.toMatchObject({
			code: 'BROWSER_WAIT_TIMEOUT',
		})
		await page.wait('Saved', { absent: false })
	})

	it('navigate clears references: a stale element refuses GONE naming look, and the next outline numbers past the previous maximum (control: the reference acts before the navigation)', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		const previous = extractOutlineReferences((await page.elements.outline()).text)
		const [name] = await page.elements.find({ role: 'textbox', name: 'Name' })
		const stale = requireValue(name)
		await stale.focus()
		expect(await page.evaluate('document.activeElement.id')).toBe('name')

		await page.navigate(fixtures.url('/overlay'))

		expect(page.elements.element(stale.reference)).toBeUndefined()
		await expect(stale.click()).rejects.toMatchObject({
			code: 'BROWSER_ELEMENT_ERROR',
			context: { reference: stale.reference, reason: 'GONE' },
			message: `Element ${stale.reference} is gone because the page changed; call look for fresh refs.`,
		})
		const next = extractOutlineReferences((await page.elements.outline()).text)
		expect(previous.length).toBeGreaterThan(0)
		expect(next.length).toBeGreaterThan(0)
		expect(Math.min(...next)).toBeGreaterThan(Math.max(...previous))
	})

	it('binds no later element to an earlier reference after churn and garbage collection (control: a removed and collected element no longer resolves)', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		await page.evaluate(
			"(() => { const pool = document.getElementById('pool'); for (let index = 0; index < 50; index += 1) { const button = document.createElement('button'); button.textContent = 'Old ' + index; pool.append(button) } return pool.children.length })()",
		)
		const earlier = extractOutlineReferences(
			(await page.elements.outline()).text
				.split('\n')
				.filter((row) => row.includes(' button "Old '))
				.join('\n'),
		)
		const [first] = await page.elements.find({ role: 'button', name: 'Old 0' })
		const removed = requireValue(first)

		await page.evaluate(
			"(() => { const pool = document.getElementById('pool'); pool.replaceChildren(); for (let index = 0; index < 10000; index += 1) { const button = document.createElement('button'); pool.append(button); button.remove() } return pool.children.length })()",
		)
		await page.send('HeapProfiler.collectGarbage')
		await page.evaluate(
			"(() => { const pool = document.getElementById('pool'); for (let index = 0; index < 50; index += 1) { const button = document.createElement('button'); button.textContent = 'Later ' + index; pool.append(button) } return pool.children.length })()",
		)
		const later = extractOutlineReferences(
			(await page.elements.outline()).text
				.split('\n')
				.filter((row) => row.includes(' button "Later '))
				.join('\n'),
		)

		expect(earlier).toHaveLength(50)
		expect(later).toHaveLength(50)
		expect(later.filter((reference) => earlier.includes(reference))).toStrictEqual([])
		await expect(removed.click()).rejects.toSatisfy(isBrowserError)
	})

	describe('a removed and collected element', () => {
		let removed: BrowserPageElementInterface

		// Establishes outside the expected-failure body that the collector reclaimed the node: a
		// detached but live node answers a different protocol error, which the classifier handles.
		beforeAll(async () => {
			const page = await browser.create({ url: fixtures.url('/form') })
			teardown.add(() => page.close())
			const [save] = await page.elements.find({ role: 'button', name: 'Save draft' })
			removed = requireValue(save)
			const backend = requireValue(
				(await page.accessibility.snapshot()).nodes.find(
					(node) => node.role === 'button' && node.name === 'Save draft',
				)?.backend,
			)
			await page.evaluate("(() => { document.getElementById('save').remove(); return true })()")
			// Collection is the collector's choice, so the churn and the forced collection repeat until
			// the protocol reports the node reclaimed, and the hook fails naming that cause otherwise.
			await retryUntil(
				'precondition: the collector reclaimed the removed Save draft node',
				async () => {
					await page.evaluate(
						"(() => { const pool = document.getElementById('pool'); for (let index = 0; index < 10000; index += 1) { const button = document.createElement('button'); pool.append(button); button.remove() } return pool.children.length })()",
					)
					await page.send('HeapProfiler.collectGarbage')
					return await page.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: backend }).then(
						() => 'resolved',
						(error: unknown) => (error instanceof Error ? error.message : String(error)),
					)
				},
				(answer) => answer === 'No node found for given backend id',
				{ attempts: 10, interval: 50, budget: 20_000 },
			)
		})

		it('refuses a click on a removed and collected element GONE naming look', async () => {
			await expect(removed.click()).rejects.toMatchObject({
				code: 'BROWSER_ELEMENT_ERROR',
				context: { reference: removed.reference, reason: 'GONE' },
				message: `Element ${removed.reference} is gone because the page changed; call look for fresh refs.`,
			})
		})
	})

	it('marks a reading stale after a same-document route and keeps references (control: a DOM mutation leaves it fresh)', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		const reading = await page.read()
		const [name] = await page.elements.find({ role: 'textbox', name: 'Name' })
		const [review] = await page.elements.find({ role: 'button', name: 'Review' })
		expect(reading.stale).toBe(false)

		await page.evaluate(
			"(() => { document.querySelector('main').append(document.createElement('p')); return true })()",
		)
		expect(reading.stale).toBe(false)

		await requireValue(review).click()
		await waitForCondition(
			'the same-document route marked the reading stale',
			() => reading.stale,
			{
				budget: 5_000,
				interval: 20,
			},
		)
		expect(page.url).toBe(fixtures.url('/form/review'))
		await requireValue(name).focus()
		expect(await page.evaluate('document.activeElement.id')).toBe('name')
		expect((await page.read()).stale).toBe(false)
	})

	it('leaves the outline usable after a back-forward cache restore', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		const navigations = createRecorder<[Readonly<Record<string, unknown>>]>()
		const misses = createRecorder<[Readonly<Record<string, unknown>>]>()
		await page.subscribe('Page.frameNavigated', navigations.handler)
		await page.subscribe('Page.backForwardCacheNotUsed', misses.handler)
		await page.navigate(fixtures.url('/article', 'localhost'))
		navigations.clear()
		await page.back({ condition: 'commit' })
		requireCacheRestore(
			navigations.calls.map(([params]) => params),
			misses.calls.map(([params]) => params),
		)

		expect(page.url).toBe(fixtures.url('/form'))
		expect(await page.evaluate('document.body.dataset.restored')).toBe('yes')
		const outline = await page.elements.outline()
		expect(outline.text).toContain('textbox "Name"')
		const [submit] = await page.elements.find({ role: 'button', name: 'Submit' })
		await requireValue(submit).click()
		expect(await page.evaluate('document.body.dataset.clicks')).toBe('submit:true')
	})

	describe('a back() served from the back-forward cache', () => {
		let outcome: Readonly<Record<string, unknown>>

		// Starts `back()` under its default condition and establishes, outside the expected-failure
		// body, that the host restored the entry from the cache rather than evicting it.
		beforeAll(async () => {
			const page = await browser.create({ url: fixtures.url('/form') })
			teardown.add(() => page.close())
			const navigations = createRecorder<[Readonly<Record<string, unknown>>]>()
			const misses = createRecorder<[Readonly<Record<string, unknown>>]>()
			await page.subscribe('Page.frameNavigated', navigations.handler)
			await page.subscribe('Page.backForwardCacheNotUsed', misses.handler)
			await page.navigate(fixtures.url('/article', 'localhost'))
			navigations.clear()
			const going = page.back({ timeout: 5_000 }).then(
				(result) => ({ status: 'resolved', url: result.url }),
				(error: unknown) => ({
					status: 'rejected',
					message: error instanceof Error ? error.message : String(error),
				}),
			)
			await waitForCondition(
				'precondition: the history navigation committed or the host reported a cache miss',
				() => navigations.count > 0 || misses.count > 0,
				{ budget: 5_000, interval: 20 },
			)
			requireCacheRestore(
				navigations.calls.map(([params]) => params),
				misses.calls.map(([params]) => params),
			)
			outcome = await going
		})

		it('resolves back() under its default load condition when the back-forward cache restores the entry', () => {
			expect(outcome).toStrictEqual({ status: 'resolved', url: fixtures.url('/form') })
		})
	})

	it('resolves registry.start() to the direct WebMCP.enable capability with a missing-method control', async () => {
		const page = await browser.create({ url: fixtures.url('/registry') })
		opened.push(page)
		const domains = requireValue(parseProtocolDomains(await page.send('Schema.getDomains')))

		expect(domains).toContain('Page')
		await expect(page.send('MissingProbe.enable')).rejects.toMatchObject({
			context: { code: BROWSER_REGISTRY_ABSENT_CODE },
		})
		const refusal: unknown = await page.send('WebMCP.enable').then(
			() => undefined,
			(error: unknown) => error,
		)
		expect(refusal).toBeOneOf([
			undefined,
			expect.objectContaining({ context: { code: BROWSER_REGISTRY_ABSENT_CODE } }),
		])
		expect(await page.registry.start()).toBe(refusal === undefined)
	})

	it('mirrors a page-registered tool through the live WebMCP domain on a browser launched with the WebMCP feature switch', async (context) => {
		const page = await registry.create({ url: fixtures.url('/registry') })
		opened.push(page)
		const refusal: unknown = await page.send('WebMCP.enable').then(
			() => undefined,
			(error: unknown) => error,
		)
		expect(refusal).toBeOneOf([
			undefined,
			expect.objectContaining({ context: { code: BROWSER_REGISTRY_ABSENT_CODE } }),
		])
		const started = await page.registry.start()

		expect(started).toBe(refusal === undefined)
		context.skip(!started, REGISTRY_ABSENT_REASON)
		await waitForCondition(
			'the registry mirrored the page tool',
			() => page.registry.tool('fixture_echo') !== undefined,
			{ budget: 5_000, interval: 20 },
		)
		expect(page.registry.tool('fixture_echo')).toMatchObject({
			name: 'fixture_echo',
			description: 'Echoes the text it receives',
			frame: page.id,
		})
	})
})
