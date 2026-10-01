import type { CDPSentMessage } from '../../setup.js'
import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { isMainThread } from 'node:worker_threads'
import { isRecord, isString } from '@orkestrel/contract'
import { toolAnnotationsToMCP } from '@orkestrel/mcp'
import { createTeardown, requireValue, waitForCondition, waitForDelay } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { describe, expect, it } from 'vitest'
import {
	BROWSER_JOURNEY_EMPTY_LISTING,
	BROWSER_JOURNEY_READONLY_REFUSAL,
	BROWSER_TOOL_COPY,
	createBrowserToolset,
} from '@src/core'
import { BrowserMCPServer, createBrowserMCPServer } from '@src/server'
import {
	BROWSE_VOCABULARY,
	BrowserLauncher,
	COOPERATIVE_SIGTERM,
	MCPStdioPair,
	openBrowseSession,
} from '../../setupServer.js'

const PROFILE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

describe('BrowserMCPServer', () => {
	it('lists the vocabulary with its copy before any launch', async () => {
		const scratch = createScratch()
		const root = join(scratch.path, 'tmp/browsers')
		const launcher = new BrowserLauncher()
		const pair = new MCPStdioPair()
		const server = createBrowserMCPServer({ root, launch: launcher.launch, stdio: pair })
		const teardown = createTeardown()
		teardown.add(() => scratch.destroy())
		teardown.add(() => server.destroy())
		try {
			await server.start()
			expect(await pair.initialize()).toMatchObject({ serverInfo: { name: 'browse' } })
			const listed = await pair.request(2, 'tools/list')
			const tools = listed['tools']
			if (!Array.isArray(tools)) throw new Error('tools/list answered no tool array')
			expect(
				tools.map((tool: unknown) => (isRecord(tool) ? tool['name'] : undefined)),
			).toStrictEqual(BROWSE_VOCABULARY)
			for (const tool of tools) {
				const copy = Object.values(BROWSER_TOOL_COPY).find(
					(row) => isRecord(tool) && row.name === tool['name'],
				)
				if (copy === undefined || !isRecord(tool))
					throw new Error(`tools/list answered an unknown tool: ${JSON.stringify(tool)}`)
				expect(tool['description']).toBe(copy.description)
				expect(tool['inputSchema']).toStrictEqual(copy.parameters)
				expect(tool['annotations']).toStrictEqual(
					copy.annotations === undefined ? undefined : toolAnnotationsToMCP(copy.annotations),
				)
			}
			expect(launcher.browsers).toStrictEqual([])
			expect(existsSync(root)).toBe(false)
		} finally {
			await teardown.destroy()
		}
	})

	it('launches one time under two concurrent first calls', async () => {
		const scratch = createScratch()
		const launcher = new BrowserLauncher()
		const pair = new MCPStdioPair()
		const server = new BrowserMCPServer({
			root: join(scratch.path, 'tmp/browsers'),
			launch: launcher.launch,
			stdio: pair,
		})
		const teardown = createTeardown()
		teardown.add(() => scratch.destroy())
		teardown.add(() => server.destroy())
		try {
			await server.start()
			await pair.initialize()
			launcher.hold()
			// One chunk carries both calls, so both reach their dispatchers before the launch settles.
			pair.send(
				{
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/call',
					params: { name: 'look', arguments: { what: 'the cart' } },
				},
				{
					jsonrpc: '2.0',
					id: 3,
					method: 'tools/call',
					params: { name: 'tabs', arguments: { what: 'the tabs' } },
				},
			)
			await waitForCondition(
				'the first launch to park at connect',
				() => launcher.browsers[0]?.connects === 1,
				{
					budget: 3000,
					interval: 10,
				},
			)
			await waitForDelay()
			launcher.release()
			const [look, tabs] = await Promise.all([pair.answer(2), pair.answer(3)])
			expect(look['isError']).toBeUndefined()
			expect(tabs['isError']).toBeUndefined()
			expect(launcher.browsers).toHaveLength(1)
			expect(launcher.browsers[0]?.connects).toBe(1)
		} finally {
			await teardown.destroy()
		}
	})

	it('rejects every caller of a failed launch and launches again on the next call', async () => {
		const scratch = createScratch()
		const root = join(scratch.path, 'tmp/browsers')
		const launcher = new BrowserLauncher({ failures: 1 })
		const pair = new MCPStdioPair()
		const server = createBrowserMCPServer({ root, launch: launcher.launch, stdio: pair })
		const teardown = createTeardown()
		teardown.add(() => scratch.destroy())
		teardown.add(() => server.destroy())
		try {
			await server.start()
			await pair.initialize()
			launcher.hold()
			pair.send(
				{
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/call',
					params: { name: 'look', arguments: { what: 'the cart' } },
				},
				{
					jsonrpc: '2.0',
					id: 3,
					method: 'tools/call',
					params: { name: 'look', arguments: { what: 'the cart' } },
				},
			)
			await waitForCondition(
				'the failing launch to park at connect',
				() => launcher.browsers[0]?.connects === 1,
				{
					budget: 3000,
					interval: 10,
				},
			)
			await waitForDelay()
			launcher.release()
			const refused = {
				content: [{ type: 'text', text: 'The fixture refused the launch' }],
				isError: true,
			}
			expect(await pair.answer(2)).toStrictEqual(refused)
			expect(await pair.answer(3)).toStrictEqual(refused)
			const failed = requireValue(launcher.browsers[0], 'no launch was recorded')
			expect(failed.destroyed).toBe(true)
			expect(existsSync(requireValue(failed.options.profile, 'the launch named no profile'))).toBe(
				false,
			)
			const retried = await pair.call(4, 'look', { what: 'the cart' })
			expect(retried.error).toBe(false)
			expect(launcher.browsers).toHaveLength(2)
			expect(readdirSync(join(root, '.profiles'))).toHaveLength(1)
		} finally {
			await teardown.destroy()
		}
	})

	it('gives a second server in the same root its own profile and never attaches', async () => {
		const scratch = createScratch()
		const root = join(scratch.path, 'tmp/browsers')
		const teardown = createTeardown()
		teardown.add(() => scratch.destroy())
		try {
			const launchers = [new BrowserLauncher(), new BrowserLauncher()]
			const pairs = [new MCPStdioPair(), new MCPStdioPair()]
			const servers = launchers.map((launcher, index) =>
				createBrowserMCPServer({
					root,
					headless: false,
					executable: '/opt/fixture/chrome',
					launch: launcher.launch,
					stdio: requireValue(pairs[index], 'no pair'),
				}),
			)
			for (const server of servers) teardown.add(() => server.destroy())
			for (const [index, server] of servers.entries()) {
				const pair = requireValue(pairs[index], 'no pair')
				await server.start()
				await pair.initialize()
				expect((await pair.call(2, 'look', { what: 'the cart' })).error).toBe(false)
			}
			const profiles = launchers.map((launcher) =>
				requireValue(launcher.browsers[0]?.options.profile, 'the launch named no profile'),
			)
			for (const [index, launcher] of launchers.entries()) {
				const profile = requireValue(profiles[index], 'no profile')
				expect(launcher.browsers[0]?.options).toMatchObject({
					headless: false,
					executable: '/opt/fixture/chrome',
					profile,
					cdp: { discover: false },
				})
				expect(dirname(profile)).toBe(join(root, '.profiles'))
				expect(basename(profile)).toMatch(PROFILE_PATTERN)
				expect(existsSync(profile)).toBe(true)
			}
			expect(new Set(profiles).size).toBe(2)
			for (const server of servers) await server.destroy()
			expect(profiles.filter((profile) => existsSync(profile))).toStrictEqual([])
			expect(readdirSync(join(root, '.profiles'))).toStrictEqual([])
		} finally {
			await teardown.destroy()
		}
	})

	it("forwards each call and its signal to the toolset's manager and returns its result", async () => {
		const scratch = createScratch()
		const withheld: CDPSentMessage[] = []
		const launcher = new BrowserLauncher({
			evaluation: (message, transport) => {
				if (message.params?.['awaitPromise'] === true) withheld.push(message)
				else transport.reply(message.id, { result: { value: true } })
			},
		})
		const pair = new MCPStdioPair()
		const server = createBrowserMCPServer({
			root: join(scratch.path, 'tmp/browsers'),
			launch: launcher.launch,
			stdio: pair,
		})
		// The same tools over an independent toolset on an identical page are the second mechanism.
		const direct = new BrowserLauncher().launch({})
		const teardown = createTeardown()
		teardown.add(() => scratch.destroy())
		teardown.add(() => direct.destroy())
		teardown.add(() => server.destroy())
		try {
			await direct.connect()
			const context = await direct.isolate()
			const toolset = createBrowserToolset(await context.create(), { context })
			teardown.add(() => toolset.destroy())
			await toolset.start()
			const expected = await toolset.tools.execute({
				id: 'look',
				name: 'look',
				arguments: { what: 'the cart' },
			})
			if (!expected.success) throw new Error(expected.error)
			const unadvertised = { what: 'the cart', colour: 'red' }
			const refusal = await toolset.tools.execute({
				id: 'look',
				name: 'look',
				arguments: unadvertised,
			})
			if (refusal.success) throw new Error('look accepted an unadvertised argument')
			await server.start()
			await pair.initialize()
			expect(await pair.call(2, 'look', { what: 'the cart' })).toStrictEqual({
				text: expected.value,
				error: false,
			})
			expect(await pair.call(3, 'look', unadvertised)).toStrictEqual({
				text: refusal.error,
				error: true,
			})
			expect(await pair.call(4, 'journeys', { what: 'every journey' })).toStrictEqual({
				text: BROWSER_JOURNEY_EMPTY_LISTING,
				error: false,
			})
			const transport = requireValue(
				launcher.browsers[0]?.fixture?.transport,
				'no launch connected',
			)
			pair.send({
				jsonrpc: '2.0',
				id: 5,
				method: 'tools/call',
				params: { name: 'wait', arguments: { text: 'Order placed' } },
			})
			await waitForCondition('the text wait to reach the page', () => withheld.length === 1, {
				budget: 3000,
				interval: 10,
			})
			pair.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 5 } })
			await waitForCondition(
				'the cancelled wait to release its page script',
				() =>
					transport.sent.some((message) => {
						const expression = message.params?.['expression']
						return (
							isString(expression) &&
							/^globalThis\["__browserTextWait\d+"\]\?\.\(\)$/u.test(expression)
						)
					}),
				{ budget: 2000, interval: 10 },
			)
			expect((await pair.call(6, 'tabs', { what: 'the tabs' })).error).toBe(false)
			expect(pair.answered).not.toContain(5)
		} finally {
			await teardown.destroy()
		}
	})

	it('passes readonly through to the journey tools', async () => {
		const scratch = createScratch()
		const teardown = createTeardown()
		teardown.add(() => scratch.destroy())
		try {
			const answers: Array<{ readonly text: string; readonly error: boolean }> = []
			for (const readonly of [true, false]) {
				const pair = new MCPStdioPair()
				const server = createBrowserMCPServer({
					root: join(scratch.path, String(readonly)),
					readonly,
					launch: new BrowserLauncher().launch,
					stdio: pair,
				})
				teardown.add(() => server.destroy())
				await server.start()
				await pair.initialize()
				answers.push(await pair.call(2, 'record', { journey: 'check-cart' }))
			}
			const [refused, recorded] = answers
			expect(refused).toStrictEqual({ text: BROWSER_JOURNEY_READONLY_REFUSAL, error: true })
			expect(recorded?.error).toBe(false)
			expect(recorded?.text).toMatch(/^Recording check-cart; /u)
		} finally {
			await teardown.destroy()
		}
	})

	describe('destroy', () => {
		it('stops admission and removes the profile at the end of input', async () => {
			const session = await openBrowseSession()
			try {
				session.pair.input.end()
				await waitForCondition(
					'the destroyed browser and the removed profile',
					() => session.browser.destroyed && !existsSync(session.profile),
					{ budget: 3000, interval: 10 },
				)
				expect(process.listenerCount('SIGTERM')).toBe(session.listeners.SIGTERM)
				expect(process.listenerCount('SIGINT')).toBe(session.listeners.SIGINT)
				expect(session.pair.input.listenerCount('data')).toBe(0)
				expect(session.launcher.browsers).toHaveLength(1)
			} finally {
				await session.teardown.destroy()
			}
		})

		// Node ends the process outright when it signals itself on Windows, so a listener never runs
		// there and neither signal has a cooperative delivery to observe.
		for (const signal of ['SIGTERM', 'SIGINT'] as const) {
			it.runIf(COOPERATIVE_SIGTERM)(
				`stops admission and removes the profile on ${signal}`,
				async () => {
					const session = await openBrowseSession()
					try {
						// A signal sent from a worker thread reaches the whole runner, not this worker.
						expect(isMainThread).toBe(true)
						process.kill(process.pid, signal)
						await waitForCondition(
							'the destroyed browser and the removed profile',
							() => session.browser.destroyed && !existsSync(session.profile),
							{ budget: 3000, interval: 10 },
						)
						expect(process.listenerCount('SIGTERM')).toBe(session.listeners.SIGTERM)
						expect(process.listenerCount('SIGINT')).toBe(session.listeners.SIGINT)
						expect(session.pair.input.listenerCount('data')).toBe(0)
						session.pair.send({
							jsonrpc: '2.0',
							id: 3,
							method: 'tools/call',
							params: { name: 'look', arguments: { what: 'the cart' } },
						})
						await waitForDelay(20)
						expect(session.pair.input.readableLength).toBeGreaterThan(0)
						expect(session.pair.answered).not.toContain(3)
						expect(session.launcher.browsers).toHaveLength(1)
					} finally {
						await session.teardown.destroy()
					}
				},
			)
		}

		it('refuses to start again after destroy', async () => {
			const pair = new MCPStdioPair()
			const server = createBrowserMCPServer({ launch: new BrowserLauncher().launch, stdio: pair })
			await server.destroy()
			await expect(server.start()).rejects.toMatchObject({ code: 'BROWSER_TOOLSET_ENDED' })
			expect(pair.input.listenerCount('data')).toBe(0)
		})
	})
})
