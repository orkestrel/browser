import type { BrowserPageInterface } from '@src/core'
import {
	existsSync,
	readdirSync,
	readFileSync,
	mkdirSync,
	writeFileSync,
	symlinkSync,
	unlinkSync,
	rmdirSync,
} from 'node:fs'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	createTeardown,
	createRecorder,
	requireValue,
	waitForCondition,
	waitForEvent,
} from '@orkestrel/test'
import { createScratch, createLoopback, readErrorCode } from '@orkestrel/test/server'
import { isRecord, isString } from '@orkestrel/contract'
import { createCDPClient, BROWSER_DEFAULT_TIMEOUT_MS, isBrowserConnectionError } from '@src/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
	createBrowserMCPServer,
	createBrowser,
	probeProcess,
	parseBrowserProfileRecord,
	formatBrowserLockEntry,
	createCDPTransport,
	createFileBrowserJourneyStore,
	BROWSER_KILL_GRACE_MS,
	BROWSER_PROCESS_EXIT_CAUSE,
} from '@src/server'
import {
	BrowseLauncher,
	createEagerBrowseChild,
	requireSystemBrowser,
	BROWSE_RECORD_BLOCKS,
	BROWSE_SIGSTOP_REASON,
	BROWSE_SIGTERM_REASON,
	BROWSE_DIRECTORY_REASON,
	openHolderServer,
	callHolderServer,
	acquireHolder,
	findHolderProfile,
	requireOutlineReference,
} from '../setupService.js'
import { createBrowserJourneyFixture } from '../setup.js'
import {
	BrowseLog,
	MCPStdioPair,
	createFixtureServer,
	waitForProcessExit,
	readExitedProcessId,
	createBrowseFixture,
	BrowseChild,
	BROWSE_VOCABULARY,
	BROWSE_ENDINGS,
	COOPERATIVE_SIGTERM,
	endBrowseChild,
} from '../setupServer.js'

describe('holders H3 built browse', () => {
	let scratch: ReturnType<typeof createScratch>
	let server: Awaited<ReturnType<typeof openHolderServer>>
	let pages: Awaited<ReturnType<typeof createLoopback>>
	let first: string
	let second: string
	let gate: PromiseWithResolvers<void> | undefined
	let entered: PromiseWithResolvers<void> | undefined
	beforeAll(async () => {
		scratch = createScratch()
		pages = await createLoopback(
			createServer(async (request, response) => {
				if (request.url === '/held') {
					entered?.resolve()
					await gate?.promise
				}
				if (request.url === '/download') {
					response.setHeader('Content-Disposition', 'attachment; filename="holders-h3-fixture.txt"')
					response.end('Owned holder download')
				} else {
					response.setHeader('Content-Type', 'text/html')
					response.end(readFileSync(new URL('../fixtures/holders.html', import.meta.url)))
				}
			}),
		)
		server = await openHolderServer(scratch.path)
		first = await acquireHolder(server.client, 'first holder')
		second = await acquireHolder(server.client, 'second holder')
	})
	afterAll(async () => {
		gate?.resolve()
		await server?.client.disconnect()
		await pages?.destroy()
		scratch.destroy()
	})

	it(
		'completes another holder action while one fixture request remains held',
		{ timeout: 5000 },
		async () => {
			gate = Promise.withResolvers<void>()
			entered = Promise.withResolvers<void>()
			let finished = false
			const held = callHolderServer(server.client, 'execute', {
				holder: first,
				name: 'navigate',
				arguments: { url: `${pages.url}/held` },
			}).finally(() => {
				finished = true
			})
			try {
				await entered.promise
				expect(
					await callHolderServer(server.client, 'execute', {
						holder: second,
						name: 'navigate',
						arguments: { url: `${pages.url}/second` },
					}),
				).toContain('Holder fixture')
				expect(finished).toBe(false)
			} finally {
				gate.resolve()
				await held
			}
		},
	)

	it('isolates cookies, localStorage, tabs, and references between holders', async () => {
		const firstView = await callHolderServer(server.client, 'execute', {
			holder: first,
			name: 'navigate',
			arguments: { url: `${pages.url}/first` },
		})
		const seed = requireOutlineReference(firstView, 'button', 'Seed state')
		await callHolderServer(server.client, 'execute', {
			holder: first,
			name: 'click',
			arguments: { ref: seed },
		})
		const secondView = await callHolderServer(server.client, 'execute', {
			holder: second,
			name: 'navigate',
			arguments: { url: `${pages.url}/second` },
		})
		expect(secondView).toContain('Cookie: empty; Storage: empty')
		await expect(
			callHolderServer(server.client, 'execute', {
				holder: second,
				name: 'click',
				arguments: { ref: seed },
			}),
		).rejects.toThrow(`Element ${seed} is not in the current view`)
		const firstAgain = await callHolderServer(server.client, 'execute', {
			holder: first,
			name: 'navigate',
			arguments: { url: `${pages.url}/first` },
		})
		expect(firstAgain).toContain('Cookie: holder=first; Storage: first')
		await callHolderServer(server.client, 'execute', {
			holder: first,
			name: 'click',
			arguments: { ref: requireOutlineReference(firstAgain, 'link', 'Open holder tab') },
		})
		expect(
			await callHolderServer(server.client, 'execute', {
				holder: first,
				name: 'tabs',
				arguments: { search: '' },
			}),
		).toContain(`${pages.url}/tab`)
		expect(
			await callHolderServer(server.client, 'execute', {
				holder: second,
				name: 'tabs',
				arguments: { search: '' },
			}),
		).not.toContain(`${pages.url}/tab`)
	})

	it('recovers a killed holder with every browser leased and keeps its loss notice local', async () => {
		await callHolderServer(server.client, 'execute', {
			holder: second,
			name: 'navigate',
			arguments: { url: `${pages.url}/victim` },
		})
		const victim = await findHolderProfile(scratch.path, `${pages.url}/victim`)
		process.kill(victim.pid, 'SIGKILL')
		expect(
			await callHolderServer(server.client, 'execute', {
				holder: first,
				name: 'look',
				arguments: { search: '' },
			}),
		).not.toContain('BROWSER_SERVER_CRASH')
		const recovered = await callHolderServer(server.client, 'execute', {
			holder: second,
			name: 'look',
			arguments: { search: '' },
		})
		expect(recovered).toContain('BROWSER_SERVER_CRASH')
		expect(recovered).toContain('about:blank')
		expect(
			await callHolderServer(server.client, 'execute', {
				holder: second,
				name: 'look',
				arguments: { search: '' },
			}),
		).not.toContain('BROWSER_SERVER_CRASH')
	})

	it('contains downloads and destroys their process and profile before capacity is reused cleanly', async () => {
		await expect(acquireHolder(server.client, 'overflow')).rejects.toThrow('BROWSER_SERVER_BUSY')
		const view = await callHolderServer(server.client, 'execute', {
			holder: first,
			name: 'navigate',
			arguments: { url: `${pages.url}/download-owner` },
		})
		const owner = await findHolderProfile(scratch.path, `${pages.url}/download-owner`)
		await callHolderServer(server.client, 'execute', {
			holder: first,
			name: 'click',
			arguments: { ref: requireOutlineReference(view, 'link', 'Download holder file') },
		})
		const download = join(owner.profile, 'downloads', 'holders-h3-fixture.txt')
		await waitForCondition(
			'completed holder download',
			() => existsSync(download) && readFileSync(download, 'utf8') === 'Owned holder download',
		)
		await callHolderServer(server.client, 'destroy', { holder: first })
		expect(probeProcess(owner.pid)).toBe(false)
		expect(existsSync(owner.profile)).toBe(false)
		first = await acquireHolder(server.client, 'clean replacement')
		expect(
			await callHolderServer(server.client, 'execute', {
				holder: first,
				name: 'tabs',
				arguments: { search: '' },
			}),
		).not.toContain(`${pages.url}/tab`)
		const clean = await callHolderServer(server.client, 'execute', {
			holder: first,
			name: 'navigate',
			arguments: { url: `${pages.url}/clean` },
		})
		expect(clean).toContain('Cookie: empty; Storage: empty')
		const replacement = await findHolderProfile(scratch.path, `${pages.url}/clean`)
		expect(replacement.pid).not.toBe(owner.pid)
		expect(replacement.profile).not.toBe(owner.profile)
	})

	it('persists a holder replay beside shared-browser navigation', { timeout: 5000 }, async () => {
		gate = Promise.withResolvers<void>()
		entered = Promise.withResolvers<void>()
		await createFileBrowserJourneyStore({ root: scratch.path }).set(
			createBrowserJourneyFixture([
				{ action: 'navigate', arguments: { url: `${pages.url}/held` } },
			]),
		)
		const replay = callHolderServer(server.client, 'execute', {
			holder: first,
			name: 'replay',
			arguments: { journey: 'check-ready' },
		})
		try {
			await entered.promise
			expect(
				await callHolderServer(server.client, 'navigate', { url: `${pages.url}/shared` }),
			).toContain('Holder fixture')
		} finally {
			gate.resolve()
			await replay
		}
		expect(await replay).toContain('Replayed check-ready: 1 of 1 steps.')
		expect(readdirSync(join(scratch.path, 'check-ready', 'runs'))).toHaveLength(1)
	})

	it('tears down every live lease process and profile', async () => {
		const records = readdirSync(join(scratch.path, '.profiles')).map((name) => ({
			profile: join(scratch.path, '.profiles', name),
			record: requireValue(
				parseBrowserProfileRecord(
					readFileSync(join(scratch.path, '.profiles', name, 'browse.json'), 'utf8'),
				),
			),
		}))
		expect(records).toHaveLength(3)
		await server.client.disconnect()
		expect(server.transport.evidence ?? '').toBe('')
		for (const { profile, record } of records) {
			expect(probeProcess(record.pid)).toBe(false)
			expect(existsSync(profile)).toBe(false)
		}
	})
})

describe('holders H3 built cleanup refusal', () => {
	it('reports a real filesystem refusal while ending several live leases', async (context) => {
		const scratch = createScratch()
		const lock = scratch.ensure('lock')
		const locker = spawn(
			process.execPath,
			[fileURLToPath(new URL('../fixtures/holder-lock.ts', import.meta.url))],
			{ cwd: lock, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
		)
		const child = new BrowseChild(
			fileURLToPath(new URL('../../dist/bin/main.js', import.meta.url)),
			scratch.path,
			{
				BROWSE_ROOT: scratch.ensure('server'),
				BROWSE_EXECUTABLE: requireSystemBrowser().executable,
				BROWSE_POOL: '3',
			},
		)
		const pids: number[] = []
		try {
			if (locker.stdout === null) throw new Error('Missing lock process output')
			await once(locker.stdout, 'data')
			let refusal: unknown
			try {
				rmdirSync(lock)
			} catch (error) {
				refusal = error
			}
			expect(readErrorCode(refusal)).toBe(refusal === undefined ? undefined : 'EBUSY')
			const supported = refusal !== undefined
			context.skip(!supported, BROWSE_DIRECTORY_REASON)
			child.send(
				{
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { name: 'acquire', arguments: { purpose: 'first live lease' } },
				},
				{
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/call',
					params: { name: 'acquire', arguments: { purpose: 'second live lease' } },
				},
			)
			await waitForCondition('both holders acquired', () => child.lines.length === 2, {
				budget: 15000,
			})
			for (const line of child.lines)
				expect(JSON.parse(line)).not.toHaveProperty('result.isError', true)
			const profiles = join(scratch.path, 'server', '.profiles')
			const folders = readdirSync(profiles).map((name) => join(profiles, name))
			expect(folders).toHaveLength(3)
			for (const folder of folders)
				pids.push(
					requireValue(parseBrowserProfileRecord(readFileSync(join(folder, 'browse.json'), 'utf8')))
						.pid,
				)
			const folder = requireValue(folders[0])
			const locked = once(locker.stdout, 'data')
			locker.stdin?.write(`${folder}\n`)
			await locked
			child.end()
			expect(await child.ending).toEqual({ code: 1, signal: null })
			expect(child.stderr).toContain('BROWSER_SERVER_TEARDOWN')
			expect(child.stderr).toContain('The browse server teardown failed')
			for (const pid of pids) expect(probeProcess(pid)).toBe(false)
			for (const other of folders) expect(existsSync(other)).toBe(other === folder)
		} finally {
			const exited = once(locker, 'exit')
			locker.stdin?.end()
			await exited
			await child.destroy()
			for (const pid of pids) {
				if (!probeProcess(pid)) continue
				process.kill(pid, 'SIGKILL')
				await waitForProcessExit(pid)
			}
			scratch.destroy()
		}
	})
})

describe('eager U8 built browse', () => {
	it('reads innerWidth 390 with BROWSE_VIEWPORT=390x844', async () => {
		const scratch = createScratch()
		const pages = await createLoopback(
			createServer((_request, response) => {
				response.setHeader('Content-Type', 'text/html')
				response.end(
					'<!doctype html><body><script>document.body.textContent = innerWidth + "x" + innerHeight</script>',
				)
			}),
		)
		const child = new BrowseChild(
			fileURLToPath(new URL('../../dist/bin/main.js', import.meta.url)),
			scratch.path,
			{ BROWSE_EXECUTABLE: requireSystemBrowser().executable, BROWSE_VIEWPORT: '390x844' },
		)
		try {
			child.send({
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'navigate',
					arguments: { url: pages.url },
				},
			})
			await waitForCondition('viewport navigation', () => child.lines.length === 1, {
				budget: 15000,
			})
			expect(JSON.parse(child.lines[0] ?? '')).not.toHaveProperty('result.isError', true)
			child.send({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: {
					name: 'plain',
					arguments: { search: '' },
				},
			})
			await waitForCondition('viewport reading', () => child.lines.length === 2)
			expect(JSON.parse(child.lines[1] ?? '')).toMatchObject({
				id: 2,
				result: { content: [{ type: 'text', text: expect.stringContaining('390x844') }] },
			})
			child.end()
			expect(await child.ending).toEqual({ code: 0, signal: null })
			expect(child.stderr).toBe('')
		} finally {
			await child.destroy()
			await pages.destroy()
			scratch.destroy()
		}
	})

	it('refuses malformed BROWSE_VIEWPORT with BROWSER_SERVER_ENVIRONMENT', async () => {
		const scratch = createScratch()
		const child = new BrowseChild(
			fileURLToPath(new URL('../../dist/bin/main.js', import.meta.url)),
			scratch.path,
			{ BROWSE_VIEWPORT: 'widexhigh', BROWSE_EXECUTABLE: join(scratch.path, 'missing/chrome') },
		)
		try {
			child.end()
			expect(await child.ending).toEqual({ code: 1, signal: null })
			expect(child.stderr).toContain('browse: BROWSER_SERVER_ENVIRONMENT: BROWSE_VIEWPORT')
			expect(child.lines).toEqual([])
			expect(existsSync(join(scratch.path, 'tmp/browsers'))).toBe(false)
		} finally {
			await child.destroy()
			scratch.destroy()
		}
	})

	for (const pool of [undefined, '', '1', '2', '3']) {
		for (const ending of BROWSE_ENDINGS) {
			it(`answers initialize, tools/list, and navigate with BROWSE_POOL=${JSON.stringify(pool)} and cleans profiles on ${ending}`, async (context) => {
				const cooperative = ending === 'EOF' || COOPERATIVE_SIGTERM
				context.skip(!cooperative, BROWSE_SIGTERM_REASON)
				const scratch = createScratch()
				const pages = await createFixtureServer()
				const child = new BrowseChild(
					fileURLToPath(new URL('../../dist/bin/main.js', import.meta.url)),
					scratch.path,
					{
						BROWSE_EXECUTABLE: requireSystemBrowser().executable,
						...(pool === undefined ? {} : { BROWSE_POOL: pool }),
					},
				)
				const pids: number[] = []
				try {
					child.send({
						jsonrpc: '2.0',
						id: 1,
						method: 'initialize',
						params: {
							protocolVersion: '2025-06-18',
							capabilities: {},
							clientInfo: { name: 'browse-bin-test', version: '1.0.0' },
						},
					})
					await waitForCondition('built initialize', () => child.lines.length === 1, {
						budget: 15000,
					})
					expect(JSON.parse(child.lines[0] ?? '')).toMatchObject({
						id: 1,
						result: { serverInfo: { name: 'browse' } },
					})
					child.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
					await waitForCondition('built vocabulary', () => child.lines.length === 2)
					const answer: unknown = JSON.parse(child.lines[1] ?? '')
					const result = isRecord(answer) ? answer['result'] : undefined
					const tools = isRecord(result) ? result['tools'] : undefined
					expect(
						Array.isArray(tools)
							? tools.map((tool: unknown) => (isRecord(tool) ? tool['name'] : undefined))
							: undefined,
					).toEqual(BROWSE_VOCABULARY)
					const url = pages.url('/form')
					child.send({
						jsonrpc: '2.0',
						id: 3,
						method: 'tools/call',
						params: { name: 'navigate', arguments: { url } },
					})
					await waitForCondition('built navigate', () => child.lines.length === 3, {
						budget: 15000,
					})
					expect(JSON.parse(child.lines[2] ?? '')).toMatchObject({
						id: 3,
						result: { content: [{ type: 'text', text: expect.stringContaining(url) }] },
					})
					expect(JSON.parse(child.lines[2] ?? '')).not.toHaveProperty('result.isError', true)
					const profiles = join(scratch.path, 'tmp/browsers/.profiles')
					const size = pool === undefined || pool === '' ? 1 : Number(pool)
					await waitForCondition(
						'built warm floor records',
						() => {
							const names = readdirSync(profiles)
							return (
								names.length === size &&
								names.every((name) => existsSync(join(profiles, name, 'browse.json')))
							)
						},
						{ budget: 15000 },
					)
					for (const name of readdirSync(profiles)) {
						expect(name.startsWith(`${child.pid}-`)).toBe(true)
						const record = requireValue(
							parseBrowserProfileRecord(readFileSync(join(profiles, name, 'browse.json'), 'utf8')),
							'built browser record',
						)
						pids.push(record.pid)
						expect(probeProcess(record.pid)).toBe(true)
					}
					endBrowseChild(child, ending)
					expect(await child.ending).toEqual({ code: 0, signal: null })
					expect(child.stderr).toBe('')
					expect(child.lines).toHaveLength(3)
					expect(readdirSync(profiles)).toEqual([])
					for (const pid of pids) expect(probeProcess(pid)).toBe(false)
				} finally {
					await child.destroy()
					for (const pid of pids) {
						if (!probeProcess(pid)) continue
						process.kill(pid, 'SIGKILL')
						await waitForProcessExit(pid)
					}
					await pages.destroy()
					scratch.destroy()
				}
			})
		}
	}
})

describe('eager U7 real browse', () => {
	it('inherits viewport on isolated pages, popups, spares, and refills', async () => {
		const launcher = new BrowseLauncher()
		const fixture = createBrowseFixture({
			executable: requireSystemBrowser().executable,
			viewport: { width: 390, height: 844 },
			pool: { size: 2 },
			launch: launcher.launch,
		})
		try {
			await fixture.server.start()
			for (const index of [0, 1, 2]) {
				await waitForCondition(
					'isolated viewport page',
					() =>
						launcher.browsers[index]
							?.contexts()
							.some((context) => context.id !== undefined && context.pages().length > 0) === true,
					{ budget: 15000 },
				)
				const browser = requireValue(launcher.browsers[index], 'warm browser')
				const context = requireValue(
					browser.contexts().find((entry) => entry.id !== undefined),
					'isolated context',
				)
				const first = requireValue(context.pages()[0], 'initial page')
				const added = await context.create()
				for (const page of [first, added])
					expect(await page.evaluate('[innerWidth, innerHeight]')).toEqual([390, 844])
				const popup = waitForEvent<readonly [BrowserPageInterface]>(
					(listener) => context.emitter.on('page', listener),
					'viewport popup',
					{ budget: 5000 },
				)
				await first.send('Runtime.evaluate', {
					expression: 'window.open("about:blank")',
					userGesture: true,
				})
				const [opened] = await popup
				expect(await opened.evaluate('[innerWidth, innerHeight]')).toEqual([390, 844])
				if (index === 1) {
					const pid = requireValue(launcher.browsers[0]?.pid, 'lease pid')
					process.kill(pid, 'SIGKILL')
					await waitForProcessExit(pid)
				}
				expect((await fixture.pair.call(index + 2, 'look', { search: 'page' })).error).toBe(false)
			}
		} finally {
			await fixture.teardown.destroy()
		}
	})

	for (const size of [1, 2]) {
		it(`replaces a killed lease at size ${size} and refuses a stale reference`, async () => {
			const launcher = new BrowseLauncher()
			const fixture = createBrowseFixture({
				executable: requireSystemBrowser().executable,
				pool: { size },
				launch: launcher.launch,
			})
			const pages = await createFixtureServer()
			try {
				await fixture.server.start()
				const url = pages.url('/form')
				const navigated = await fixture.pair.call(2, 'navigate', { url })
				expect(navigated.error).toBe(false)
				const reading = await fixture.pair.call(3, 'look', { search: 'button' })
				const reference = requireValue(reading.text.match(/\be[1-9]\d*\b/)?.[0], 'old reference')
				await waitForCondition('warm floor', () => launcher.connections.length === size, {
					budget: 15000,
				})
				const pid = requireValue(launcher.browsers[0]?.pid, 'lease pid')
				process.kill(pid, 'SIGKILL')
				await waitForProcessExit(pid)
				const answer = await fixture.pair.call(4, 'look', { search: 'page' })
				expect(answer.error).toBe(false)
				expect(answer.text).toMatch(/^BROWSER_SERVER_CRASH:/)
				expect(answer.text).toContain(url)
				await waitForCondition(
					'exactly one replacement',
					() => launcher.connections.length === size + 1,
					{ budget: 15000 },
				)
				expect(launcher.browsers).toHaveLength(size + 1)
				const successor = requireValue(launcher.browsers[1], 'successor')
				expect(successor.pid).not.toBe(pid)
				expect(
					successor
						.contexts()
						.find((context) => context.id !== undefined)
						?.pages()[0]?.url,
				).toBe('about:blank')
				expect((await fixture.pair.call(5, 'navigate', { url })).error).toBe(false)
				const stale = await fixture.pair.call(6, 'click', { ref: reference })
				expect(stale.error).toBe(true)
				expect(stale.text).not.toContain('BROWSER_SERVER_')
			} finally {
				await fixture.teardown.destroy()
				await pages.destroy()
			}
		})
	}

	it('keeps the lease when a spare is killed and launches one replacement', async () => {
		const launcher = new BrowseLauncher()
		const fixture = createBrowseFixture({
			executable: requireSystemBrowser().executable,
			pool: { size: 2 },
			launch: launcher.launch,
		})
		try {
			await fixture.server.start()
			await waitForCondition(
				'spare is warmed',
				() =>
					launcher.browsers[1]
						?.contexts()
						.some((context) => context.id !== undefined && context.pages().length > 0) === true,
				{ budget: 15000 },
			)
			const lease = requireValue(launcher.browsers[0]?.pid, 'lease pid')
			process.kill(requireValue(launcher.browsers[1]?.pid, 'spare pid'), 'SIGKILL')
			await waitForCondition('spare replaced', () => launcher.connections.length === 3, {
				budget: 15000,
			})
			const answer = await fixture.pair.call(2, 'look', { search: 'page' })
			expect(answer.error).toBe(false)
			expect(answer.text).not.toContain('BROWSER_SERVER_CRASH')
			expect(launcher.browsers[0]?.pid).toBe(lease)
			expect(launcher.browsers).toHaveLength(3)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('reports an unknown navigation outcome after exactly one held route request', async () => {
		let requests = 0
		const route = await createLoopback(
			createServer(() => {
				requests += 1
			}),
		)
		const launcher = new BrowseLauncher()
		const fixture = createBrowseFixture({
			executable: requireSystemBrowser().executable,
			pool: { size: 2 },
			launch: launcher.launch,
		})
		try {
			await fixture.server.start()
			const pending = fixture.pair.call(2, 'navigate', { url: `${route.url}/held` })
			await waitForCondition('held route request', () => requests === 1, { budget: 5000 })
			process.kill(requireValue(launcher.browsers[0]?.pid, 'lease pid'), 'SIGKILL')
			const answer = await pending
			expect(answer.error).toBe(true)
			expect(answer.text).toMatch(/^BROWSER_SERVER_UNRESOLVED:/)
			expect(answer.text).toContain('Browse did not repeat the call')
			expect((await fixture.pair.call(3, 'look', { search: 'page' })).text).toMatch(
				/^BROWSER_SERVER_CRASH:/,
			)
			expect(requests).toBe(1)
		} finally {
			await fixture.teardown.destroy()
			await route.destroy()
		}
	})

	it('notes a current renderer crash but ignores a background renderer crash', async () => {
		const launcher = new BrowseLauncher()
		const fixture = createBrowseFixture({
			executable: requireSystemBrowser().executable,
			pool: { size: 2 },
			launch: (options) => launcher.launch({ ...options, timeout: 5000 }),
		})
		let client: ReturnType<typeof createCDPClient> | undefined
		try {
			await fixture.server.start()
			const browser = requireValue(launcher.browsers[0], 'lease')
			const context = requireValue(
				browser.contexts().find((entry) => entry.id !== undefined),
				'isolated context',
			)
			const view = requireValue(context.pages()[0], 'view')
			const background = await context.create()
			client = createCDPClient({
				transport: createCDPTransport({ url: requireValue(browser.endpoint, 'endpoint') }),
			})
			await client.connect()
			for (const page of [background, view]) {
				const crashed = createRecorder<readonly []>()
				page.emitter.on('crash', crashed.handler)
				const attached: unknown = await client.send('Target.attachToTarget', {
					targetId: page.id,
					flatten: true,
				})
				if (!isRecord(attached) || !isString(attached['sessionId']))
					throw new Error('Missing crash session')
				await client
					.send('Page.crash', undefined, { session: attached['sessionId'], timeout: 1000 })
					.catch(() => undefined)
				await waitForCondition(
					'renderer crash event without Inspector.enable',
					() => crashed.count === 1,
				)
				const answer = await fixture.pair.call(page === background ? 2 : 3, 'look', {
					search: 'page',
				})
				expect(answer.error).toBe(false)
				expect(answer.text.startsWith('BROWSER_SERVER_CRASH:')).toBe(page === view)
			}
		} finally {
			await client?.close()
			await fixture.teardown.destroy()
		}
	})

	it('reports ENOENT after its executable path disappears at size one', async () => {
		const scratch = createScratch()
		const executable = requireSystemBrowser().executable
		const link = join(scratch.path, 'installation')
		// A directory junction on Windows and a directory symlink on POSIX retain adjacent resources.
		symlinkSync(dirname(executable), link, 'junction')
		const launcher = new BrowseLauncher()
		const fixture = createBrowseFixture({
			executable: join(link, basename(executable)),
			pool: { size: 1 },
			launch: launcher.launch,
		})
		try {
			await fixture.server.start()
			const pid = requireValue(launcher.browsers[0]?.pid, 'lease pid')
			unlinkSync(link)
			expect(existsSync(join(link, basename(executable)))).toBe(false)
			process.kill(pid, 'SIGKILL')
			const answer = await fixture.pair.call(2, 'look', { search: 'page' })
			expect(answer.error).toBe(true)
			expect(answer.text).toMatch(/^BROWSER_SERVER_CRASH:/)
			expect(answer.text).toMatch(/\nBROWSER_SERVER_UNAVAILABLE:.*ENOENT/)
			expect(launcher.browsers).toHaveLength(3)
			expect(
				fixture.log.lines.filter((line) => line.startsWith('browse: BROWSER_SERVER_LAUNCH:')),
			).toEqual([
				expect.stringMatching(/^browse: BROWSER_SERVER_LAUNCH:.*ENOENT.*\n$/),
				expect.stringMatching(/^browse: BROWSER_SERVER_LAUNCH:.*ENOENT.*\n$/),
			])
			expect(fixture.log.lines.some((line) => line.includes('BROWSER_SERVER_UNAVAILABLE:'))).toBe(
				false,
			)
		} finally {
			await fixture.teardown.destroy()
			if (existsSync(link)) unlinkSync(link)
			scratch.destroy()
		}
	})

	it('probes SIGSTOP support and recovers a stopped lease within its ping deadlines', async (context) => {
		const launcher = new BrowseLauncher()
		const fixture = createBrowseFixture({
			executable: requireSystemBrowser().executable,
			pool: { size: 2 },
			launch: (options) => launcher.launch({ ...options, timeout: 3000 }),
		})
		try {
			await fixture.server.start()
			await waitForCondition('warm spare', () => launcher.connections.length === 2, {
				budget: 15000,
			})
			const pid = requireValue(launcher.browsers[0]?.pid, 'lease pid')
			let refusal: unknown
			try {
				process.kill(pid, 'SIGSTOP')
			} catch (error) {
				refusal = error
			}
			expect(readErrorCode(refusal)).toBe(refusal === undefined ? undefined : 'ERR_UNKNOWN_SIGNAL')
			const supported = refusal === undefined
			context.skip(!supported, BROWSE_SIGSTOP_REASON)
			const began = performance.now()
			const answer = await fixture.pair.call(2, 'look', { search: 'page' })
			expect(answer.error).toBe(false)
			expect(answer.text).toMatch(/^BROWSER_SERVER_CRASH:/)
			await waitForProcessExit(pid)
			expect(probeProcess(pid)).toBe(false)
			await waitForCondition(
				'replacement after ping deadline',
				() => launcher.browsers.length === 3,
				{ budget: 3000 },
			)
			expect(performance.now() - began).toBeLessThan(6000)
		} finally {
			await fixture.teardown.destroy()
		}
	})
	it('forces a hung stand-in process to exit at the ping deadline and serves its successor', async () => {
		const scratch = createScratch()
		const transcript = join(scratch.path, 'cdp.txt')
		const launcher = new BrowseLauncher()
		// The deadline covers Node startup and local CDP setup under service-suite contention.
		// Exit must follow the ping within half a deadline, before graceful teardown's command waits.
		const timeout = 2000
		const fixture = createBrowseFixture({
			launch: (options) =>
				launcher.launch(
					launcher.browsers.length === 0
						? {
								...options,
								executable: process.execPath,
								args: [
									fileURLToPath(new URL('../fixtures/hung/main.ts', import.meta.url)),
									transcript,
								],
								timeout,
							}
						: { ...options, executable: requireSystemBrowser().executable },
				),
		})
		try {
			await fixture.server.start()
			const pid = requireValue(launcher.browsers[0]?.pid, 'stand-in pid')
			expect(probeProcess(pid)).toBe(true)
			const pending = fixture.pair.call(2, 'tabs', { search: 'page' })
			await waitForCondition(
				'withheld per-call ping',
				() =>
					readFileSync(transcript, 'utf8')
						.split(/\r\n|\n/)
						.filter((method) => method === 'Browser.getVersion').length === 2,
			)
			await waitForCondition('forced stand-in exit', () => !probeProcess(pid), {
				budget: timeout * 1.5,
			})
			expect(probeProcess(pid)).toBe(false)
			const answer = await pending
			expect(answer.error).toBe(false)
			expect(answer.text).toMatch(/^BROWSER_SERVER_CRASH:/)
			expect(answer.text).toContain('about:blank')
			const successor = requireValue(launcher.browsers[1]?.pid, 'successor pid')
			expect(successor).not.toBe(pid)
			expect(probeProcess(successor)).toBe(true)
			const next = await fixture.pair.call(3, 'tabs', { search: 'page' })
			expect(next.error).toBe(false)
			expect(next.text).not.toContain('BROWSER_SERVER_CRASH:')
			expect(launcher.browsers[1]?.pid).toBe(successor)
		} finally {
			await fixture.teardown.destroy()
			scratch.destroy()
		}
	})
})

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
			// The detached sweep can spend an attach deadline and a close deadline before exit grace.
			// Browser reports its process exit through the coded error event, even after transport loss.
			const exited = waitForEvent<[]>(
				(listener) => {
					browser.emitter.on('error', (error) => {
						if (
							isBrowserConnectionError(error) &&
							error.context?.['cause'] === BROWSER_PROCESS_EXIT_CAUSE
						)
							listener()
					})
					return () => browser.emitter.clear('error')
				},
				'the synthesized orphan browser exit',
				{ budget: 2 * BROWSER_DEFAULT_TIMEOUT_MS + BROWSER_KILL_GRACE_MS },
			)
			await Promise.all([server.start(), exited])
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
		const log = new BrowseLog()
		const server = createBrowserMCPServer({
			root: scratch.path,
			executable: join(scratch.path, 'missing.exe'),
			launch: launcher.launch,
			stdio: pair,
			log,
		})
		try {
			await expect(server.start()).rejects.toThrow('ENOENT')
			expect(await pair.initialize()).toMatchObject({
				code: -32000,
				data: { code: 'BROWSER_SERVER_UNAVAILABLE' },
			})
			expect(launcher.browsers).toHaveLength(2)
			expect(log.lines).toEqual([
				expect.stringMatching(/^browse: BROWSER_SERVER_LAUNCH:.*ENOENT.*\n$/),
				expect.stringMatching(/^browse: BROWSER_SERVER_LAUNCH:.*ENOENT.*\n$/),
			])
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
