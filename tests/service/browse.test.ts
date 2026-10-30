import type { BrowserPageInterface } from '@src/core'
import { inspectProcess } from '@orkestrel/process/server'
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
	retryUntil,
} from '@orkestrel/test'
import { createScratch, createLoopback, readErrorCode } from '@orkestrel/test/server'
import { attempt, isRecord, isString } from '@orkestrel/contract'
import {
	createCDPClient,
	BROWSER_DEFAULT_TIMEOUT_MS,
	BROWSER_TOOL_LIMIT,
	isBrowserError,
} from '@src/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
	createBrowserMCPServer,
	createBrowser,
	parseBrowserProfileRecord,
	formatBrowserLockEntry,
	createWebSocketCDPTransport,
	createFileBrowserJourneyStore,
	createFileBrowserRunStore,
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
	recordHolderJourney,
	ContextFixture,
	CONTEXT_STORES,
	inspectHolderContext,
	callContextTool,
	downloadContextFile,
	readContextFolders,
} from '../setupService.js'
import { BrowserFixtureValue, createBrowserJourneyFixture } from '../setup.js'
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

describe('contexts C2 built browse on one browser', () => {
	const scratch = new BrowserFixtureValue<ReturnType<typeof createScratch> | undefined>(undefined)
	const server = new BrowserFixtureValue<Awaited<ReturnType<typeof openHolderServer>> | undefined>(
		undefined,
	)
	const pages = new BrowserFixtureValue<ContextFixture | undefined>(undefined)
	const holder = new BrowserFixtureValue<string | undefined>(undefined)
	beforeAll(async () => {
		scratch.value = createScratch()
		pages.value = new ContextFixture()
		await pages.required.start()
		server.value = await openHolderServer(scratch.required.path, 1)
		holder.value = await acquireHolder(server.required.client, 'C2 source context')
	})
	afterAll(async () => {
		await server.value?.client.disconnect()
		await pages.value?.destroy()
		scratch.value?.destroy()
	})

	it('audit repair 9: an adopted page tool may take the removed look name', async () => {
		const launcher = new BrowseLauncher()
		const fixture = createBrowseFixture({
			browser: { executable: requireSystemBrowser().executable },
			pool: {
				size: 1,
				launch: (options) =>
					launcher.launch({
						...options,
						args: [...(options.args ?? []), '--enable-features=WebMCP'],
					}),
			},
		})
		try {
			await fixture.server.start()
			await fixture.pair.initialize()
			const navigation = await fixture.pair.call(2, 'navigate', {
				url: pages.required.url + '/adopted-look',
			})
			expect(navigation.error).toBe(false)
			const browser = requireValue(launcher.browsers[0])
			const page = requireValue(
				browser
					.contexts()
					.flatMap((context) => context.pages())
					.find((candidate) => candidate.url.includes('/adopted-look')),
			)
			expect(
				await page.evaluate(
					"(() => { const registry = navigator.modelContext ?? document.modelContext; registry.registerTool({ name: 'look', description: 'Reports the page authored answer', inputSchema: { type: 'object', properties: { purpose: { type: 'string' } }, required: ['purpose'] }, execute: () => 'A page authored look answer.' }); return true })()",
				),
			).toBe(true)
			const id = new BrowserFixtureValue(3)
			await retryUntil(
				'the page tool is mirrored',
				() => fixture.pair.request(id.value++, 'tools/list'),
				(result) => JSON.stringify(result).includes('Reports the page authored answer'),
				{ budget: 5000, interval: 50 },
			)
			expect(
				await fixture.pair.call(id.value++, 'look', { purpose: 'Read the page tool answer' }),
			).toEqual({ error: false, text: 'A page authored look answer.' })
		} finally {
			await fixture.teardown.destroy()
		}
	})
	it('audit repair 5: a crash notice redacts the departed address with the lost toolset secrets', async () => {
		const secret = 'departure-private-4821'
		const source = await pages.required.read(
			server.required.client,
			holder.required,
			'secret-departure',
		)
		const observer = await inspectHolderContext(scratch.required.path, source.url)
		try {
			const attached: unknown = await observer.client.send('Target.attachToTarget', {
				targetId: observer.target,
				flatten: true,
			})
			if (!isRecord(attached) || !isString(attached['sessionId']))
				throw new Error('Missing session')
			await observer.client.send(
				'Runtime.evaluate',
				{ expression: `document.body.innerHTML = '<input aria-label="Private">'` },
				{ session: attached['sessionId'] },
			)
			const read = await callContextTool(server.required.client, holder.required, 'read', {
				from: 1,
			})
			const ref = requireOutlineReference(read, 'textbox', 'Private')
			await callContextTool(server.required.client, holder.required, 'type', {
				ref,
				text: secret,
				secret: true,
			})
			await callContextTool(server.required.client, holder.required, 'navigate', {
				url: new URL(source.url).origin + '/state?secret=' + secret,
			})
			process.kill(observer.pid, 'SIGKILL')
			await waitForProcessExit(observer.pid)
			const result = await callContextTool(server.required.client, holder.required, 'read', {
				from: 1,
			})
			expect(result).toContain('SERVER_CRASH')
			expect(result).not.toContain(secret)
			expect(result).toContain('[redacted]')
		} finally {
			await observer.client.close()
		}
	})
	it('bounds complete MCP reading windows and refuses the removed names', async () => {
		const source = await pages.required.read(
			server.required.client,
			holder.required,
			'reading-bound',
		)
		const observer = await inspectHolderContext(scratch.required.path, source.url)
		try {
			const attached: unknown = await observer.client.send('Target.attachToTarget', {
				targetId: observer.target,
				flatten: true,
			})
			if (!isRecord(attached) || !isString(attached['sessionId']))
				throw new Error('Missing reading session')
			await observer.client.send(
				'Runtime.evaluate',
				{
					expression: `document.body.innerHTML = ${JSON.stringify(Array.from({ length: 200 }, (_, index) => `<p>Entry ${index}. ${'Store material. '.repeat(10)}</p>`).join(''))}`,
				},
				{ session: attached['sessionId'] },
			)
			const first = await callContextTool(server.required.client, holder.required, 'read', {
				from: 1,
			})
			expect(first.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
			const from = Number(requireValue(/call read with from (\d+) for more/.exec(first))[1])
			const next = await callContextTool(server.required.client, holder.required, 'read', { from })
			expect(next.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
			expect(next).toContain(`\n${from}: `)
			for (const name of ['look', 'plain', 'tabs'])
				await expect(
					callContextTool(server.required.client, holder.required, name, {}),
				).rejects.toThrow(`tool not found: ${name}`)
		} finally {
			await observer.client.close()
		}
	})

	it('isolates every web store between simultaneous holders on one browser', async () => {
		expect(await server.required.client.call('tools', { holder: holder.required })).toMatchObject({
			resultType: 'complete',
			value: {
				holder: holder.required,
				tools: expect.arrayContaining([expect.objectContaining({ name: 'navigate' })]),
			},
		})
		const source = await pages.required.read(
			server.required.client,
			holder.required,
			'seed&cache=simultaneous',
		)
		const observer = await inspectHolderContext(scratch.required.path, source.url)
		try {
			await observer.client.send('Browser.setPermission', {
				permission: { name: 'geolocation' },
				setting: 'granted',
				origin: pages.required.url,
				browserContextId: observer.context,
			})
			const control = await pages.required.read(
				server.required.client,
				holder.required,
				'cache=simultaneous',
			)
			expect(pages.required.count('/cached/simultaneous'), 'source HTTP cache readback').toBe(1)
			const sibling = await pages.required.read(
				server.required.client,
				undefined,
				'cache=simultaneous',
			)
			const other = await inspectHolderContext(scratch.required.path, sibling.url)
			try {
				expect(other.pid, 'both holders share the real browser process').toBe(observer.pid)
			} finally {
				await other.client.close()
			}
			for (const store of CONTEXT_STORES) {
				expect(control.state[store.name], `${store.name}: source write/read control`).toEqual(
					store.source,
				)
				expect(sibling.state[store.name], `${store.name}: sibling isolation`).toEqual(store.empty)
			}
			expect(other.context).not.toBe(observer.context)
			expect(pages.required.count('/cached/simultaneous'), 'sibling HTTP cache is separate').toBe(2)
			const sourceFile = await downloadContextFile(
				server.required.client,
				holder.required,
				observer.profile,
				'source',
				observer.target,
			)
			const download = await pages.required.read(
				server.required.client,
				undefined,
				'marker=sibling',
			)
			const target = await inspectHolderContext(scratch.required.path, download.url)
			await target.client.close()
			const siblingFile = await downloadContextFile(
				server.required.client,
				undefined,
				observer.profile,
				'sibling',
				target.target,
			)
			expect(basename(sourceFile)).toBe(basename(siblingFile))
			expect(dirname(sourceFile), 'downloads have separate generation folders').not.toBe(
				dirname(siblingFile),
			)
			expect(readFileSync(sourceFile, 'utf8'), 'source download readback').toBe('source')
			expect(readFileSync(siblingFile, 'utf8'), 'sibling download readback').toBe('sibling')
		} finally {
			await observer.client.close()
		}
	})

	it('replaces a destroyed holder with empty web stores and an empty downloads folder', async () => {
		await callHolderServer(server.required.client, 'destroy', { holder: holder.required })
		holder.value = await acquireHolder(server.required.client, 'C2 replacement source')
		const source = await pages.required.read(
			server.required.client,
			holder.required,
			'seed&cache=replacement',
		)
		const observer = await inspectHolderContext(scratch.required.path, source.url)
		try {
			await observer.client.send('Browser.setPermission', {
				permission: { name: 'geolocation' },
				setting: 'granted',
				origin: pages.required.url,
				browserContextId: observer.context,
			})
			const control = await pages.required.read(
				server.required.client,
				holder.required,
				'cache=replacement',
			)
			for (const store of CONTEXT_STORES)
				expect(
					control.state[store.name],
					`${store.name}: destroyed holder write/read control`,
				).toEqual(store.source)
			expect(pages.required.count('/cached/replacement'), 'old HTTP cache control').toBe(1)
			const old = dirname(
				await downloadContextFile(
					server.required.client,
					holder.required,
					observer.profile,
					'source',
					observer.target,
				),
			)
			await callHolderServer(server.required.client, 'destroy', { holder: holder.required })
			expect(existsSync(old), 'destroy removes the old downloads folder').toBe(false)
			const sibling = await callContextTool(server.required.client, undefined, 'read', {
				from: 1,
				search: '',
			})
			expect(sibling, 'destroy keeps the sibling context alive').not.toContain('SERVER_CRASH')
			expect(
				inspectProcess(observer.pid) !== false,
				`destroy retains the sibling browser; ${server.required.transport.evidence ?? ''}`,
			).toBe(true)
			const retained = readContextFolders(observer.profile)
			holder.value = await acquireHolder(server.required.client, 'C2 replacement')
			const folders = readContextFolders(observer.profile).filter(
				(folder) => !retained.includes(folder),
			)
			expect(folders, 'one fresh download folder').toHaveLength(1)
			expect(readdirSync(requireValue(folders[0])), 'replacement downloads start empty').toEqual([])
			const replacement = await pages.required.read(
				server.required.client,
				holder.required,
				'cache=replacement',
			)
			for (const store of CONTEXT_STORES)
				expect(replacement.state[store.name], `${store.name}: replacement isolation`).toEqual(
					store.empty,
				)
			expect(pages.required.count('/cached/replacement'), 'replacement HTTP cache is empty').toBe(2)
		} finally {
			await observer.client.close()
		}
	})

	it('removes the destroyed context from Target.getBrowserContexts', async () => {
		const source = await pages.required.read(server.required.client, holder.required)
		const observer = await inspectHolderContext(scratch.required.path, source.url)
		try {
			expect(await observer.client.send('Target.getBrowserContexts')).toHaveProperty(
				'browserContextIds',
				expect.arrayContaining([observer.context]),
			)
			await callHolderServer(server.required.client, 'destroy', { holder: holder.required })
			expect(await observer.client.send('Target.getBrowserContexts')).toHaveProperty(
				'browserContextIds',
				expect.not.arrayContaining([observer.context]),
			)
			holder.value = await acquireHolder(server.required.client, 'C2 after disposal')
		} finally {
			await observer.client.close()
		}
	})

	it('ends every holder on a killed browser with its own URL notice and a fresh blank context', async () => {
		const named = await pages.required.read(server.required.client, holder.required)
		const shared = await pages.required.read(server.required.client)
		const victim = await findHolderProfile(scratch.required.path, named.url)
		expect((await findHolderProfile(scratch.required.path, shared.url)).pid).toBe(victim.pid)
		process.kill(victim.pid, 'SIGKILL')
		await waitForProcessExit(victim.pid)
		for (const entry of [
			{ holder: holder.required, url: named.url },
			{ holder: undefined, url: shared.url },
		]) {
			const answer = await callContextTool(server.required.client, entry.holder, 'read', {
				from: 1,
				search: '',
			})
			expect(answer, 'each affected holder receives a crash notice').toMatch(/SERVER_CRASH:/)
			expect(answer, 'each notice keeps its own last URL').toContain(entry.url)
			expect(answer, 'recovery has a blank active page').toContain('about:blank')
			expect(
				await callContextTool(server.required.client, entry.holder, 'read', {
					from: 1,
					search: '',
				}),
				'notice is delivered once',
			).not.toContain('SERVER_CRASH')
		}
	})

	it('contains an active renderer crash to its holder context', async () => {
		const named = await pages.required.read(server.required.client, holder.required)
		const shared = await pages.required.read(server.required.client, undefined, 'seed')
		const victim = await inspectHolderContext(scratch.required.path, named.url)
		try {
			expect((await findHolderProfile(scratch.required.path, shared.url)).pid).toBe(victim.pid)
			const attached: unknown = await victim.client.send('Target.attachToTarget', {
				targetId: victim.target,
				flatten: true,
			})
			if (!isRecord(attached) || !isString(attached['sessionId']))
				throw new Error('Missing crash session')
			await victim.client
				.send('Page.crash', undefined, { session: attached['sessionId'], timeout: 1000 })
				.catch(() => undefined)
			const recovered = await callContextTool(server.required.client, holder.required, 'read', {
				from: 1,
			}).catch((error: unknown) => {
				if (!String(error).includes('SERVER_UNRESOLVED: The current page renderer crashed.'))
					throw error
				return callContextTool(server.required.client, holder.required, 'read', { from: 1 })
			})
			expect(recovered).toContain('SERVER_CRASH:')
			expect(recovered).toContain(named.url)
			expect(recovered).toContain('about:blank')
			const sibling = await callContextTool(server.required.client, undefined, 'read', { from: 1 })
			expect(sibling).not.toContain('SERVER_CRASH')
			expect(sibling).toContain('"local":"source"')
			expect((await findHolderProfile(scratch.required.path, shared.url)).pid).toBe(victim.pid)
			expect(await victim.client.send('Target.getBrowserContexts')).toHaveProperty(
				'browserContextIds',
				expect.not.arrayContaining([victim.context]),
			)
		} finally {
			await victim.client.close()
		}
	})

	it('keeps all busy headless holders visible with advancing timers and animation frames', async () => {
		const group = randomUUID()
		const readings = await Promise.all([
			pages.required.read(server.required.client, holder.required, `busy=${group}`),
			pages.required.read(server.required.client, undefined, `busy=${group}`),
		])
		for (const reading of readings) {
			expect(reading.state['visibility'], `${reading.url}: active page visibility`).toBe('visible')
			expect(reading.state['ticks'], `${reading.url}: timer advances`).toBeGreaterThan(0)
			expect(reading.state['frames'], `${reading.url}: animation advances`).toBeGreaterThan(0)
		}
	})
})

describe('contexts C2 built browse on two browsers', () => {
	const scratch = new BrowserFixtureValue<ReturnType<typeof createScratch> | undefined>(undefined)
	const server = new BrowserFixtureValue<Awaited<ReturnType<typeof openHolderServer>> | undefined>(
		undefined,
	)
	const pages = new BrowserFixtureValue<ContextFixture | undefined>(undefined)
	beforeAll(async () => {
		scratch.value = createScratch()
		pages.value = new ContextFixture()
		await pages.required.start()
		server.value = await openHolderServer(scratch.required.path, 2)
	})
	afterAll(async () => {
		await server.value?.client.disconnect()
		await pages.value?.destroy()
		scratch.value?.destroy()
	})
	it('keeps every holder on the other browser free of a crash notice', async () => {
		const holders: Array<string | undefined> = [undefined]
		for (const index of Array.from({ length: 3 }).keys())
			holders.push(await acquireHolder(server.required.client, `C2 browser boundary ${index}`))
		const owners = await Promise.all(
			holders.map(async (holder) => {
				const page = await pages.required.read(server.required.client, holder, 'seed')
				return {
					holder,
					url: page.url,
					...(await findHolderProfile(scratch.required.path, page.url)),
				}
			}),
		)
		const victim = requireValue(owners[0])
		expect(new Set(owners.map((owner) => owner.pid)).size).toBe(2)
		expect(owners.filter((owner) => owner.pid !== victim.pid)).toHaveLength(2)
		process.kill(victim.pid, 'SIGKILL')
		await waitForProcessExit(victim.pid)
		for (const owner of owners.filter((entry) => entry.pid === victim.pid)) {
			const answer = await callContextTool(server.required.client, owner.holder, 'read', {
				from: 1,
			})
			expect(answer).toContain('SERVER_CRASH:')
			expect(answer).toContain(owner.url)
		}
		for (const owner of owners.filter((entry) => entry.pid !== victim.pid)) {
			const answer = await callContextTool(server.required.client, owner.holder, 'read', {
				from: 1,
			})
			expect(answer, 'other browser holder has no notice').not.toContain('SERVER_CRASH')
			expect(answer, 'other browser holder keeps state').toContain('"local":"source"')
			expect((await findHolderProfile(scratch.required.path, owner.url)).pid).toBe(owner.pid)
		}
	})
})

describe('holders H3 built browse', () => {
	const scratch = new BrowserFixtureValue<ReturnType<typeof createScratch> | undefined>(undefined)
	const server = new BrowserFixtureValue<Awaited<ReturnType<typeof openHolderServer>> | undefined>(
		undefined,
	)
	const pages = new BrowserFixtureValue<Awaited<ReturnType<typeof createLoopback>> | undefined>(
		undefined,
	)
	const first = new BrowserFixtureValue<string | undefined>(undefined)
	const second = new BrowserFixtureValue<string | undefined>(undefined)
	const gate = new BrowserFixtureValue<PromiseWithResolvers<void> | undefined>(undefined)
	const entered = new BrowserFixtureValue<PromiseWithResolvers<void> | undefined>(undefined)
	beforeAll(async () => {
		scratch.value = createScratch()
		pages.value = await createLoopback(
			createServer(async (request, response) => {
				if (request.url === '/held') {
					entered.value?.resolve()
					await gate.value?.promise
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
		server.value = await openHolderServer(scratch.required.path, 3, 1)
		first.value = await acquireHolder(server.required.client, 'first holder')
		second.value = await acquireHolder(server.required.client, 'second holder')
	})
	afterAll(async () => {
		gate.value?.resolve()
		await server.value?.client.disconnect()
		await pages.value?.destroy()
		scratch.required.destroy()
	})

	it(
		'completes another holder action while one fixture request remains held',
		{ timeout: 5000 },
		async () => {
			gate.value = Promise.withResolvers<void>()
			entered.value = Promise.withResolvers<void>()
			const finished = new BrowserFixtureValue(false)
			const held = callHolderServer(server.required.client, 'execute', {
				holder: first.required,
				name: 'navigate',
				arguments: { url: `${pages.required.url}/held` },
			}).finally(() => {
				finished.value = true
			})
			try {
				await entered.required.promise
				expect(
					await callHolderServer(server.required.client, 'execute', {
						holder: second.required,
						name: 'navigate',
						arguments: { url: `${pages.required.url}/second` },
					}),
				).toContain('Holder fixture')
				expect(finished.value).toBe(false)
			} finally {
				gate.required.resolve()
				await held
			}
		},
	)

	it('isolates cookies, localStorage, tabs, and references between holders', async () => {
		const firstView = await callHolderServer(server.required.client, 'execute', {
			holder: first.required,
			name: 'navigate',
			arguments: { url: `${pages.required.url}/first` },
		})
		const seed = requireOutlineReference(firstView, 'button', 'Seed state')
		await callHolderServer(server.required.client, 'execute', {
			holder: first.required,
			name: 'click',
			arguments: { ref: seed },
		})
		const secondView = await callHolderServer(server.required.client, 'execute', {
			holder: second.required,
			name: 'navigate',
			arguments: { url: `${pages.required.url}/second` },
		})
		expect(secondView).toContain('Cookie: empty; Storage: empty')
		await expect(
			callHolderServer(server.required.client, 'execute', {
				holder: second.required,
				name: 'click',
				arguments: { ref: seed },
			}),
		).rejects.toThrow(`Element [ref=${seed}] is not in the current view`)
		const firstAgain = await callHolderServer(server.required.client, 'execute', {
			holder: first.required,
			name: 'navigate',
			arguments: { url: `${pages.required.url}/first` },
		})
		expect(firstAgain).toContain('Cookie: holder=first; Storage: first')
		await callHolderServer(server.required.client, 'execute', {
			holder: first.required,
			name: 'click',
			arguments: { ref: requireOutlineReference(firstAgain, 'link', 'Open holder tab') },
		})
		expect(
			await callHolderServer(server.required.client, 'execute', {
				holder: first.required,
				name: 'read',
				arguments: { from: 1 },
			}),
		).toContain(`${pages.required.url}/tab`)
		expect(
			await callHolderServer(server.required.client, 'execute', {
				holder: second.required,
				name: 'read',
				arguments: { from: 1 },
			}),
		).not.toContain(`${pages.required.url}/tab`)
	})

	it('recovers a killed holder with every browser leased and keeps its loss notice local', async () => {
		await callHolderServer(server.required.client, 'execute', {
			holder: second.required,
			name: 'navigate',
			arguments: { url: `${pages.required.url}/victim` },
		})
		const victim = await findHolderProfile(scratch.required.path, `${pages.required.url}/victim`)
		process.kill(victim.pid, 'SIGKILL')
		expect(
			await callHolderServer(server.required.client, 'execute', {
				holder: first.required,
				name: 'read',
				arguments: { from: 1, search: '' },
			}),
		).not.toContain('SERVER_CRASH')
		const recovered = await callHolderServer(server.required.client, 'execute', {
			holder: second.required,
			name: 'read',
			arguments: { from: 1, search: '' },
		})
		expect(recovered).toContain('SERVER_CRASH')
		expect(recovered).toContain('about:blank')
		expect(
			await callHolderServer(server.required.client, 'execute', {
				holder: second.required,
				name: 'read',
				arguments: { from: 1, search: '' },
			}),
		).not.toContain('SERVER_CRASH')
	})

	it('contains downloads and removes them before holder capacity is reused cleanly', async () => {
		await expect(acquireHolder(server.required.client, 'overflow')).rejects.toThrow('SERVER_BUSY')
		await callHolderServer(server.required.client, 'execute', {
			holder: first.required,
			name: 'navigate',
			arguments: { url: `${pages.required.url}/download-owner` },
		})
		const owner = await inspectHolderContext(
			scratch.required.path,
			`${pages.required.url}/download-owner`,
		)
		const download = await downloadContextFile(
			server.required.client,
			first.required,
			owner.profile,
			'Owned holder download',
			owner.target,
			'Download holder file',
			'holders-h3-fixture.txt',
		).finally(() => owner.client.close())
		await callHolderServer(server.required.client, 'destroy', { holder: first.required })
		expect(existsSync(dirname(download))).toBe(false)
		expect(inspectProcess(owner.pid) !== false).toBe(true)
		expect(existsSync(owner.profile)).toBe(true)
		first.value = await acquireHolder(server.required.client, 'clean replacement')
		expect(
			await callHolderServer(server.required.client, 'execute', {
				holder: first.required,
				name: 'read',
				arguments: { from: 1 },
			}),
		).not.toContain(`${pages.required.url}/tab`)
		const clean = await callHolderServer(server.required.client, 'execute', {
			holder: first.required,
			name: 'navigate',
			arguments: { url: `${pages.required.url}/clean` },
		})
		expect(clean).toContain('Cookie: empty; Storage: empty')
		const replacement = await findHolderProfile(
			scratch.required.path,
			`${pages.required.url}/clean`,
		)
		expect(replacement.pid).toBe(owner.pid)
		expect(replacement.profile).toBe(owner.profile)
	})

	it('persists a holder replay beside shared-browser navigation', { timeout: 5000 }, async () => {
		gate.value = Promise.withResolvers<void>()
		entered.value = Promise.withResolvers<void>()
		await createFileBrowserJourneyStore({ root: scratch.required.path }).set(
			createBrowserJourneyFixture([
				{ action: 'navigate', arguments: { url: `${pages.required.url}/held` } },
			]),
		)
		const replay = callHolderServer(server.required.client, 'execute', {
			holder: first.required,
			name: 'replay',
			arguments: { journey: 'check-ready' },
		})
		try {
			await entered.required.promise
			expect(
				await callHolderServer(server.required.client, 'navigate', {
					url: `${pages.required.url}/shared`,
				}),
			).toContain('Holder fixture')
		} finally {
			gate.required.resolve()
			await replay
		}
		expect(await replay).toContain('Replayed check-ready: 1 of 1 steps.')
		expect(readdirSync(join(scratch.required.path, 'check-ready', 'runs'))).toHaveLength(1)
	})

	it('completes simultaneous replays of one recorded journey on two holders repeatedly', async () => {
		await recordHolderJourney(
			server.required.client,
			'replay-race',
			`${pages.required.url}/replay-race`,
		)
		for (const repetition of Array.from({ length: 4 }).keys()) {
			const peer =
				repetition % 2 === 0
					? callHolderServer(server.required.client, 'replay', { journey: 'replay-race' })
					: callHolderServer(server.required.client, 'execute', {
							holder: second.required,
							name: 'replay',
							arguments: { journey: 'replay-race' },
						})
			const named = callHolderServer(server.required.client, 'execute', {
				holder: first.required,
				name: 'replay',
				arguments: { journey: 'replay-race' },
			})
			const results = await Promise.all([peer, named])
			for (const result of results) {
				expect(result, `repetition ${repetition + 1}`).toContain(
					'Replayed replay-race: 1 of 1 steps.',
				)
				expect(result).toContain(`${pages.required.url}/replay-race`)
			}
		}
		expect(readdirSync(join(scratch.required.path, 'replay-race', 'runs'))).toHaveLength(8)
		const runs = await createFileBrowserRunStore({ root: scratch.required.path }).list(
			'replay-race',
		)
		expect(runs.entries).toHaveLength(8)
		expect(runs.faults).toEqual([])
		for (const run of runs.entries) {
			expect(run.outcome).toBe('complete')
			expect(run.fault).toBeUndefined()
			expect(run.steps).toMatchObject([{ id: 's1', action: 'navigate', outcome: 'done' }])
		}
	})

	it('replays another journey after the holder finishes recording', async () => {
		await recordHolderJourney(
			server.required.client,
			'replay-other',
			`${pages.required.url}/replay-other`,
		)
		await recordHolderJourney(
			server.required.client,
			'recorded-holder',
			`${pages.required.url}/recorded-holder`,
			second.required,
		)
		const result = await callHolderServer(server.required.client, 'execute', {
			holder: second.required,
			name: 'replay',
			arguments: { journey: 'replay-other' },
		})
		expect(result).toContain('Replayed replay-other: 1 of 1 steps.')
		expect(result).toContain(`${pages.required.url}/replay-other`)
		expect(result).not.toContain(`${pages.required.url}/recorded-holder`)
	})

	it('tears down every live lease process and profile', async () => {
		const records = readdirSync(join(scratch.required.path, '.profiles')).map((name) => ({
			profile: join(scratch.required.path, '.profiles', name),
			record: requireValue(
				parseBrowserProfileRecord(
					readFileSync(join(scratch.required.path, '.profiles', name, 'browse.json'), 'utf8'),
				),
			),
		}))
		expect(records).toHaveLength(3)
		await server.required.client.disconnect()
		expect(server.required.transport.evidence ?? '').toBe('')
		for (const { profile, record } of records) {
			expect(inspectProcess(record.pid) !== false).toBe(false)
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
				BROWSE_CONTEXTS: '1',
			},
		)
		const pids: number[] = []
		try {
			if (locker.stdout === null) throw new Error('Missing lock process output')
			await once(locker.stdout, 'data')
			const probe = attempt(() => rmdirSync(lock))
			const refusal = probe.success ? undefined : probe.error
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
			expect(child.stderr).toContain('SERVER_TEARDOWN')
			expect(child.stderr).toContain('The browse server teardown failed')
			for (const pid of pids) expect(inspectProcess(pid) !== false).toBe(false)
			for (const other of folders) expect(existsSync(other)).toBe(other === folder)
		} finally {
			const exited = once(locker, 'exit')
			locker.stdin?.end()
			await exited
			await child.destroy()
			for (const pid of pids) {
				if (inspectProcess(pid) === false) continue
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
					name: 'read',
					arguments: { from: 1, search: '' },
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

	it('refuses malformed BROWSE_VIEWPORT with SERVER_ENVIRONMENT', async () => {
		const scratch = createScratch()
		const child = new BrowseChild(
			fileURLToPath(new URL('../../dist/bin/main.js', import.meta.url)),
			scratch.path,
			{ BROWSE_VIEWPORT: 'widexhigh', BROWSE_EXECUTABLE: join(scratch.path, 'missing/chrome') },
		)
		try {
			child.end()
			expect(await child.ending).toEqual({ code: 1, signal: null })
			expect(child.stderr).toContain('browse: SERVER_ENVIRONMENT: BROWSE_VIEWPORT')
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
						expect(inspectProcess(record.pid) !== false).toBe(true)
					}
					endBrowseChild(child, ending)
					expect(await child.ending).toEqual({ code: 0, signal: null })
					expect(child.stderr).toBe('')
					expect(child.lines).toHaveLength(3)
					expect(readdirSync(profiles)).toEqual([])
					for (const pid of pids) expect(inspectProcess(pid) !== false).toBe(false)
				} finally {
					await child.destroy()
					for (const pid of pids) {
						if (inspectProcess(pid) === false) continue
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
			browser: {
				executable: requireSystemBrowser().executable,
				viewport: { width: 390, height: 844 },
			},
			pool: { size: 2, launch: launcher.launch },
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
				expect(
					(await fixture.pair.call(index + 2, 'read', { from: 1, search: 'page' })).error,
				).toBe(false)
			}
		} finally {
			await fixture.teardown.destroy()
		}
	})

	for (const size of [1, 2]) {
		it(`replaces a killed lease at size ${size} and refuses a stale reference`, async () => {
			const launcher = new BrowseLauncher()
			const fixture = createBrowseFixture({
				browser: { executable: requireSystemBrowser().executable },
				pool: { size, launch: launcher.launch },
			})
			const pages = await createFixtureServer()
			try {
				await fixture.server.start()
				const url = pages.url('/form')
				const navigated = await fixture.pair.call(2, 'navigate', { url })
				expect(navigated.error).toBe(false)
				const reading = await fixture.pair.call(3, 'read', { from: 1, search: 'button' })
				const reference = requireValue(reading.text.match(/\be[1-9]\d*\b/)?.[0], 'old reference')
				await waitForCondition('warm floor', () => launcher.connections.length === size, {
					budget: 15000,
				})
				const pid = requireValue(launcher.browsers[0]?.pid, 'lease pid')
				process.kill(pid, 'SIGKILL')
				await waitForProcessExit(pid)
				const answer = await fixture.pair.call(4, 'read', { from: 1, search: 'page' })
				expect(answer.error).toBe(false)
				expect(answer.text).toContain('SERVER_CRASH:')
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
				expect(stale.text).not.toContain('SERVER_')
			} finally {
				await fixture.teardown.destroy()
				await pages.destroy()
			}
		})
	}

	it('keeps the lease when a spare is killed and launches one replacement', async () => {
		const launcher = new BrowseLauncher()
		const fixture = createBrowseFixture({
			browser: { executable: requireSystemBrowser().executable },
			pool: { size: 2, launch: launcher.launch },
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
			const answer = await fixture.pair.call(2, 'read', { from: 1, search: 'page' })
			expect(answer.error).toBe(false)
			expect(answer.text).not.toContain('SERVER_CRASH')
			expect(launcher.browsers[0]?.pid).toBe(lease)
			expect(launcher.browsers).toHaveLength(3)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('reports an unknown navigation outcome after exactly one held route request', async () => {
		const requests = new BrowserFixtureValue(0)
		const route = await createLoopback(
			createServer(() => {
				requests.value += 1
			}),
		)
		const launcher = new BrowseLauncher()
		const fixture = createBrowseFixture({
			browser: { executable: requireSystemBrowser().executable },
			pool: { size: 2, launch: launcher.launch },
		})
		try {
			await fixture.server.start()
			const pending = fixture.pair.call(2, 'navigate', { url: `${route.url}/held` })
			await waitForCondition('held route request', () => requests.value === 1, { budget: 5000 })
			process.kill(requireValue(launcher.browsers[0]?.pid, 'lease pid'), 'SIGKILL')
			const answer = await pending
			expect(answer.error).toBe(true)
			expect(answer.text).toMatch(/^SERVER_UNRESOLVED:/)
			expect(answer.text).toContain('Browse did not repeat the call')
			expect((await fixture.pair.call(3, 'read', { from: 1, search: 'page' })).text).toMatch(
				/SERVER_CRASH:/,
			)
			expect(requests.value).toBe(1)
		} finally {
			await fixture.teardown.destroy()
			await route.destroy()
		}
	})

	it.each(['launch', 'reverse'])(
		'notes a current renderer crash but ignores a background renderer crash with %s inventory',
		async (order) => {
			const launcher = new BrowseLauncher()
			const pages = await createFixtureServer()
			const url = pages.url('/form')
			const fixture = createBrowseFixture({
				browser: { executable: requireSystemBrowser().executable },
				pool: { size: 2, launch: (options) => launcher.launch({ ...options, timeout: 5000 }) },
			})
			const client = new BrowserFixtureValue<ReturnType<typeof createCDPClient> | undefined>(
				undefined,
			)
			try {
				await fixture.server.start()
				expect((await fixture.pair.call(1, 'navigate', { url })).error).toBe(false)
				await waitForCondition(
					'both browser contexts prepared',
					() =>
						launcher.browsers.length === 2 &&
						launcher.browsers.every((entry) =>
							entry
								.contexts()
								.some((context) => context.id !== undefined && context.pages().length > 0),
						),
					{ budget: 5000 },
				)
				const browsers = order === 'launch' ? launcher.browsers : [...launcher.browsers].reverse()
				const browser = requireValue(
					browsers.find((entry) =>
						entry.contexts().some((context) => context.pages().some((page) => page.url === url)),
					),
					'lease',
				)
				const context = requireValue(
					browser.contexts().find((entry) => entry.id !== undefined),
					'isolated context',
				)
				const view = requireValue(context.pages()[0], 'view')
				expect(view.url, 'the crash target must belong to the shared MCP lease').toBe(url)
				const background = await context.create()
				client.value = createCDPClient({
					transport: createWebSocketCDPTransport({
						url: requireValue(browser.endpoint, 'endpoint'),
					}),
				})
				await client.required.connect()
				for (const page of [background, view]) {
					const crashed = createRecorder<readonly []>()
					page.emitter.on('crash', crashed.handler)
					const attached: unknown = await client.required.send('Target.attachToTarget', {
						targetId: page.id,
						flatten: true,
					})
					if (!isRecord(attached) || !isString(attached['sessionId']))
						throw new Error('Missing crash session')
					await client.required
						.send('Page.crash', undefined, { session: attached['sessionId'], timeout: 1000 })
						.catch(() => undefined)
					await waitForCondition(
						'renderer crash event without Inspector.enable',
						() => crashed.count === 1,
						{ budget: 5000 },
					).catch((cause: unknown) => {
						throw new Error(
							`Expected one ${page === background ? 'background' : 'current'} renderer crash; received ${crashed.count}; closed=${page.closed}`,
							{ cause },
						)
					})
					const answer = await fixture.pair.call(page === background ? 2 : 3, 'read', {
						from: 1,
						search: 'page',
					})
					expect(answer.error).toBe(false)
					expect(answer.text.includes('SERVER_CRASH:')).toBe(page === view)
				}
			} finally {
				await client.value?.close()
				await fixture.teardown.destroy()
				await pages.destroy()
			}
		},
	)

	it('reports ENOENT after its executable path disappears at size one', async () => {
		const scratch = createScratch()
		const executable = requireSystemBrowser().executable
		const link = join(scratch.path, 'installation')
		// A directory junction on Windows and a directory symlink on POSIX retain adjacent resources.
		symlinkSync(dirname(executable), link, 'junction')
		const launcher = new BrowseLauncher()
		const fixture = createBrowseFixture({
			browser: { executable: join(link, basename(executable)) },
			pool: { size: 1, launch: launcher.launch },
		})
		try {
			await fixture.server.start()
			const pid = requireValue(launcher.browsers[0]?.pid, 'lease pid')
			unlinkSync(link)
			expect(existsSync(join(link, basename(executable)))).toBe(false)
			process.kill(pid, 'SIGKILL')
			const answer = await fixture.pair.call(2, 'read', { from: 1, search: 'page' })
			expect(answer.error).toBe(true)
			expect(answer.text).toContain('SERVER_CRASH:')
			expect(answer.text).toMatch(/\nSERVER_UNAVAILABLE:.*ENOENT/)
			expect(launcher.browsers).toHaveLength(3)
			expect(fixture.log.lines.filter((line) => line.startsWith('browse: SERVER_LAUNCH:'))).toEqual(
				[
					expect.stringMatching(/^browse: SERVER_LAUNCH:.*ENOENT.*\n$/),
					expect.stringMatching(/^browse: SERVER_LAUNCH:.*ENOENT.*\n$/),
				],
			)
			expect(fixture.log.lines.some((line) => line.includes('SERVER_UNAVAILABLE:'))).toBe(false)
		} finally {
			await fixture.teardown.destroy()
			if (existsSync(link)) unlinkSync(link)
			scratch.destroy()
		}
	})

	it('probes SIGSTOP support and recovers a stopped lease within its ping deadlines', async (context) => {
		const launcher = new BrowseLauncher()
		const fixture = createBrowseFixture({
			browser: { executable: requireSystemBrowser().executable },
			pool: { size: 2, launch: (options) => launcher.launch({ ...options, timeout: 3000 }) },
		})
		try {
			await fixture.server.start()
			await waitForCondition('warm spare', () => launcher.connections.length === 2, {
				budget: 15000,
			})
			const pid = requireValue(launcher.browsers[0]?.pid, 'lease pid')
			const probe = attempt(() => process.kill(pid, 'SIGSTOP'))
			const refusal = probe.success ? undefined : probe.error
			expect(readErrorCode(refusal)).toBe(refusal === undefined ? undefined : 'ERR_UNKNOWN_SIGNAL')
			const supported = refusal === undefined
			context.skip(!supported, BROWSE_SIGSTOP_REASON)
			const began = performance.now()
			const answer = await fixture.pair.call(2, 'read', { from: 1, search: 'page' })
			expect(answer.error).toBe(false)
			expect(answer.text).toContain('SERVER_CRASH:')
			await waitForProcessExit(pid)
			expect(inspectProcess(pid) !== false).toBe(false)
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
			pool: {
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
			},
		})
		try {
			await fixture.server.start()
			const pid = requireValue(launcher.browsers[0]?.pid, 'stand-in pid')
			expect(inspectProcess(pid) !== false).toBe(true)
			const pending = fixture.pair.call(2, 'read', { from: 1 })
			const exited = waitForCondition(
				'withheld per-call ping',
				() =>
					readFileSync(transcript, 'utf8')
						.split(/\r\n|\n/)
						.filter((method) => method === 'Browser.getVersion').length === 2,
			).then(() =>
				waitForCondition('forced stand-in exit', () => inspectProcess(pid) === false, {
					budget: timeout * 1.5,
				}),
			)
			const [answer] = await Promise.all([pending, exited])
			expect(inspectProcess(pid) !== false).toBe(false)
			expect(answer.error).toBe(false)
			expect(answer.text).toContain('SERVER_CRASH:')
			expect(answer.text).toContain('about:blank')
			const successor = requireValue(launcher.browsers[1]?.pid, 'successor pid')
			expect(successor).not.toBe(pid)
			expect(inspectProcess(successor) !== false).toBe(true)
			const next = await fixture.pair.call(3, 'read', { from: 1 })
			expect(next.error).toBe(false)
			expect(next.text).not.toContain('SERVER_CRASH:')
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
			stdio: new MCPStdioPair(),
			log: new BrowseLog(),
			browser: { executable },
		})
		const orphan = new BrowserFixtureValue<number | undefined>(undefined)
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
			orphan.value = record.pid
			expect(
				inspectProcess(record.pid) !== false,
				`browser ${record.pid} before killing server ${child.pid}; executable ${executable}`,
			).toBe(true)
			child.kill('SIGKILL')
			await child.ending
			// spawnBrowserProcess (src/server/helpers.ts:431) detaches only off Windows.
			if (process.platform === 'win32') await waitForProcessExit(record.pid)
			expect(
				inspectProcess(record.pid) !== false,
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
			if (orphan.value !== undefined && inspectProcess(orphan.required) !== false) {
				process.kill(orphan.required, 'SIGKILL')
				await waitForProcessExit(orphan.required)
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
			stdio: new MCPStdioPair(),
			log: new BrowseLog(),
			browser: { executable },
		})
		try {
			await browser.connect()
			const pid = requireValue(browser.pid, 'orphan pid')
			const endpoint = requireValue(browser.endpoint, 'orphan endpoint')
			const folder = scratch.ensure(
				join('server', '.profiles', formatBrowserLockEntry(readExitedProcessId(), randomUUID())),
			)
			writeFileSync(join(folder, 'browse.json'), JSON.stringify({ pid, endpoint }))
			expect(inspectProcess(pid) !== false).toBe(true)
			// The detached sweep can spend an attach deadline and a close deadline before exit grace.
			// Browser reports its process exit through the coded error event, even after transport loss.
			const exited = waitForEvent<[]>(
				(listener) => {
					browser.emitter.on('error', (error) => {
						if (
							isBrowserError(error) &&
							error.code === 'CONNECTION' &&
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
			expect(inspectProcess(pid) !== false).toBe(false)
			await server.destroy()
			expect(existsSync(folder)).toBe(false)
		} finally {
			await server.destroy()
			await browser.destroy()
			scratch.destroy()
		}
	})
	it('starts connected, keeps navigate and read on one pid, and tears down the floor', async () => {
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
			stdio: pair,
			log,
			browser: { executable: requireSystemBrowser().executable },
			pool: { size: 2, launch: launcher.launch },
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
			expect(inspectProcess(pid) !== false).toBe(true)
			await pair.initialize()
			expect((await pair.call(2, 'navigate', { url: fixture.url('/form') })).error).toBe(false)
			expect((await pair.call(3, 'read', { from: 1, search: 'button' })).error).toBe(false)
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
				expect(inspectProcess(requireValue(connection.pid, 'pid')) !== false).toBe(false)
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
			stdio: pair,
			log,
			browser: { executable: join(scratch.path, 'missing.exe') },
			pool: { launch: launcher.launch },
		})
		try {
			await expect(server.start()).rejects.toThrow('ENOENT')
			expect(await pair.initialize()).toMatchObject({
				code: -32000,
				data: { code: 'SERVER_UNAVAILABLE' },
			})
			expect(launcher.browsers).toHaveLength(2)
			expect(log.lines).toEqual([
				expect.stringMatching(/^browse: SERVER_LAUNCH:.*ENOENT.*\n$/),
				expect.stringMatching(/^browse: SERVER_LAUNCH:.*ENOENT.*\n$/),
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
				stdio: new MCPStdioPair(),
				log: new BrowseLog(),
				browser: { executable },
				pool: {
					launch: (options) => {
						const browser = createBrowser(options)
						browsers.push(browser)
						browser.emitter.on('connect', () =>
							mkdirSync(join(requireValue(options.profile, 'profile'), blocked)),
						)
						return browser
					},
				},
			})
			try {
				await expect(server.start()).rejects.toMatchObject({ code: 'SERVER_UNAVAILABLE' })
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
