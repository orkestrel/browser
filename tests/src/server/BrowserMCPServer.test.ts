import type { CDPSentMessage, CDPTestTransportInterface } from '../../setup.js'
import type { BrowserPageInterface } from '@src/core'
import { createHook } from 'node:async_hooks'
import { existsSync, readdirSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
import { Writable } from 'node:stream'
import { createServer } from 'node:http'
import { basename, dirname, join } from 'node:path'
import { isMainThread } from 'node:worker_threads'
import { isRecord, isString, parseJSON } from '@orkestrel/contract'
import {
	bindClient,
	createDuplexClientTransport,
	createMCPClient,
	toolAnnotationsToMCP,
	MCP_MODERN_VERSION,
} from '@orkestrel/mcp'
import {
	createTeardown,
	createRecorder,
	requireValue,
	retryUntil,
	waitForCondition,
	waitForDelay,
	waitForEvent,
} from '@orkestrel/test'
import { createLoopback, createScratch, readErrorCode } from '@orkestrel/test/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBrowserJourneyFixture, replyOk } from '../../setup.js'
import { BrowseLauncher, requireSystemBrowser } from '../../setupService.js'
import { FileBrowserStore } from '../../../src/server/stores/FileBrowserStore.js'
import {
	BROWSER_JOURNEY_EMPTY_LISTING,
	BROWSER_JOURNEY_READONLY_REFUSAL,
	BROWSER_TOOL_COPY,
	createBrowserToolset,
	BrowserError,
	CDPError,
} from '@src/core'
import {
	createBrowser,
	createBrowserMCPServer,
	createFileBrowserJourneyStore,
	createFileBrowserRunStore,
	formatBrowserLockEntry,
	BROWSER_SERVER_RECORD,
	BROWSER_SERVER_COPY,
} from '@src/server'
import {
	BROWSE_VOCABULARY,
	BrowserLauncher,
	BrowserPromiseObserver,
	COOPERATIVE_SIGTERM,
	MCPStdioPair,
	openBrowseSession,
	createBrowseFixture,
	readExitedProcessId,
	createStallServer,
	createCDPTestServer,
	waitForProcessExit,
} from '../../setupServer.js'

const PROFILE_PATTERN = /^[1-9]\d*-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

describe('holders H3 journey admission', () => {
	const launcher = new BrowseLauncher()
	let fixture: ReturnType<typeof createBrowseFixture>
	let first: string
	let second: string
	let id = 1
	beforeAll(async () => {
		fixture = createBrowseFixture({
			executable: requireSystemBrowser().executable,
			pool: { contexts: 1, size: 3 },
			launch: launcher.launch,
		})
		await fixture.server.start()
		const a = parseJSON(
			(await fixture.pair.call(id++, 'acquire', { purpose: 'first replay' })).text,
		)
		const b = parseJSON(
			(await fixture.pair.call(id++, 'acquire', { purpose: 'second replay' })).text,
		)
		if (!isRecord(a) || !isString(a['holder']) || !isRecord(b) || !isString(b['holder']))
			throw new Error('Missing holders')
		first = a['holder']
		second = b['holder']
	}, 20000)
	afterAll(() => fixture.teardown.destroy())

	it('refuses forget across holders while concurrent replays persist distinct runs', async () => {
		const starting = Promise.withResolvers<void>()
		const entered = Promise.withResolvers<void>()
		const firstRelease = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		let requests = 0
		const pages = await createLoopback(
			createServer(async (_request, response) => {
				requests += 1
				if (requests === 1) starting.resolve()
				if (requests === 2) entered.resolve()
				await (requests === 1 ? firstRelease.promise : release.promise)
				response.end('<!doctype html><title>Ready</title><body>Ready</body>')
			}),
		)
		const store = createFileBrowserJourneyStore({ root: fixture.root })
		await store.set(
			createBrowserJourneyFixture([{ action: 'navigate', arguments: { url: pages.url } }]),
		)
		const a = fixture.pair.call(id++, 'execute', {
			holder: first,
			name: 'replay',
			arguments: { journey: 'check-ready' },
		})
		await Promise.race([
			starting.promise,
			a.then((result) => {
				throw new Error(JSON.stringify(result))
			}),
		])
		const b = fixture.pair.call(id++, 'execute', {
			holder: second,
			name: 'replay',
			arguments: { journey: 'check-ready' },
		})
		try {
			await Promise.race([
				entered.promise,
				b.then((result) => {
					throw new Error(JSON.stringify(result))
				}),
			])
			const refused = await fixture.pair.call(id++, 'forget', { journey: 'check-ready' })
			expect(refused.error).toBe(true)
			expect(refused.text).toContain('BROWSER_JOURNEY_LOCKED')
			const directories = readdirSync(join(fixture.root, 'check-ready', 'runs'))
			expect(directories).toHaveLength(2)
			expect(new Set(directories).size).toBe(2)
			firstRelease.resolve()
			expect((await a).error).toBe(false)
			expect((await fixture.pair.call(id++, 'forget', { journey: 'check-ready' })).text).toContain(
				'BROWSER_JOURNEY_LOCKED',
			)
			release.resolve()
			for (const result of await Promise.all([a, b])) {
				expect(result.error).toBe(false)
				expect(result.text).toContain('Replayed check-ready: 1 of 1 steps.')
			}
			const runs = createFileBrowserRunStore({ root: fixture.root })
			for (const directory of directories)
				expect((await runs.get('check-ready', directory))?.outcome).toBe('complete')
			expect((await fixture.pair.call(id++, 'forget', { journey: 'check-ready' })).error).toBe(
				false,
			)
		} finally {
			release.resolve()
			firstRelease.resolve()
			await Promise.allSettled([a, b])
			await pages.destroy()
		}
	})

	it('releases admission after cancellation and after a holder loss', async () => {
		for (const loss of [false, true]) {
			const entered = Promise.withResolvers<void>()
			const release = Promise.withResolvers<void>()
			const pages = await createLoopback(
				createServer(async (_request, response) => {
					entered.resolve()
					await release.promise
					response.end('<!doctype html><body>Ready</body>')
				}),
			)
			const store = createFileBrowserJourneyStore({ root: fixture.root })
			await store.set(
				createBrowserJourneyFixture([{ action: 'navigate', arguments: { url: pages.url } }]),
			)
			const request = id++
			const settled = Promise.withResolvers<void>()
			const observer = new BrowserPromiseObserver(/at BrowserMCPServer\.#forward/, settled.resolve)
			fixture.pair.send({
				jsonrpc: '2.0',
				id: request,
				method: 'tools/call',
				params: {
					name: 'execute',
					arguments: { holder: first, name: 'replay', arguments: { journey: 'check-ready' } },
				},
			})
			try {
				await entered.promise
				if (loss) process.kill(requireValue(launcher.browsers[1]?.pid), 'SIGKILL')
				else
					fixture.pair.send({
						jsonrpc: '2.0',
						method: 'notifications/cancelled',
						params: { requestId: request },
					})
				if (loss) await fixture.pair.answer(request)
				// MCP suppresses a cancelled reply; observe the real dispatch promise's settlement.
				await settled.promise
				expect(observer.resolved).toBeDefined()
				expect((await fixture.pair.call(id++, 'forget', { journey: 'check-ready' })).error).toBe(
					false,
				)
			} finally {
				observer.destroy()
				release.resolve()
				await pages.destroy()
			}
		}
	})

	it('keeps the per-name store lock and revision check for recordings on different holders', async () => {
		const pages = await createLoopback(
			createServer((_request, response) => response.end('<!doctype html><body>Ready</body>')),
		)
		const entered = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		let locked: Promise<void> | undefined
		try {
			for (const holder of [first, second]) {
				expect(
					(
						await fixture.pair.call(id++, 'execute', {
							holder,
							name: 'record',
							arguments: { journey: 'same-recording' },
						})
					).error,
				).toBe(false)
				expect(
					(
						await fixture.pair.call(id++, 'execute', {
							holder,
							name: 'navigate',
							arguments: { url: pages.url },
						})
					).error,
				).toBe(false)
			}
			const files = new FileBrowserStore({ root: fixture.root })
			locked = files.lock(join(fixture.root, 'same-recording', 'journey.lock'), async () => {
				entered.resolve()
				await release.promise
			})
			await entered.promise
			const refused = await fixture.pair.call(id++, 'execute', {
				holder: first,
				name: 'save',
				arguments: { description: 'First recording' },
			})
			expect(refused.error).toBe(true)
			expect(refused.text).toContain('is locked')
			release.resolve()
			await locked
			expect(
				(
					await fixture.pair.call(id++, 'execute', {
						holder: first,
						name: 'save',
						arguments: { description: 'First recording' },
					})
				).error,
			).toBe(false)
			const stale = await fixture.pair.call(id++, 'execute', {
				holder: second,
				name: 'save',
				arguments: { description: 'Second recording' },
			})
			expect(stale.error).toBe(true)
			expect(stale.text).toContain('A journey named "same-recording" is saved')
			expect(
				(await createFileBrowserJourneyStore({ root: fixture.root }).get('same-recording'))?.journey
					.description,
			).toBe('First recording')
		} finally {
			release.resolve()
			await locked
			await pages.destroy()
		}
	})
})

describe('holders H2', () => {
	it('settles failed holder disposal and reports cleanup at server teardown', async () => {
		const failure = new Error('holder cleanup failed')
		const healthy = new BrowserLauncher()
		const faulty = new BrowserLauncher({
			cleanup: failure,
			disposal: (message, transport) => transport.fail(message.id, failure.message),
		})
		const fixture = createBrowseFixture({
			pool: { contexts: 1, size: 2 },
			launch: (options) =>
				healthy.browsers.length === 0 ? healthy.launch(options) : faulty.launch(options),
		})
		try {
			await fixture.server.start()
			const acquired = parseJSON(
				(await fixture.pair.call(2, 'acquire', { purpose: 'cleanup failure' })).text,
			)
			if (!isRecord(acquired)) throw new Error('Missing holder')
			for (const id of [3, 4])
				expect(await fixture.pair.call(id, 'destroy', { holder: acquired['holder'] })).toEqual({
					text: 'Holder destroyed.',
					error: false,
				})
			await expect(fixture.server.destroy()).rejects.toMatchObject({
				errors: expect.arrayContaining([failure]),
			})
		} finally {
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})

	it('preserves the acquisition abort error when retiring its grant fails', async () => {
		const fixture = createBrowseFixture(
			{ pool: { contexts: 1, size: 2 } },
			{
				cleanup: new Error('retirement cleanup failed'),
				disposal: (message, transport) => transport.fail(message.id, 'context disposal failed'),
			},
		)
		await fixture.server.start()
		let acquisition: Promise<unknown> | undefined
		const entered = Promise.withResolvers<void>()
		const hook = createHook({
			init: (_id, category, _trigger, resource: unknown) => {
				if (
					category !== 'PROMISE' ||
					!/at BrowserMCPServer\.#acquire/.test(new Error().stack ?? '')
				)
					return
				hook.disable()
				if (resource instanceof Promise) acquisition = resource
				entered.resolve()
			},
		}).enable()
		const served = new BrowserPromiseObserver(/at BrowserMCPServer\.#serve/, () =>
			fixture.pair.send({
				jsonrpc: '2.0',
				method: 'notifications/cancelled',
				params: { requestId: 2 },
			}),
		)
		try {
			fixture.pair.send({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'acquire', arguments: { purpose: 'aborted grant' } },
			})
			await entered.promise
			await expect(requireValue(acquisition)).rejects.toMatchObject({ name: 'AbortError' })
			expect(fixture.launcher.browsers[1]?.destroyed).toBe(true)
		} finally {
			hook.disable()
			served.destroy()
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})

	it('detaches the acquisition signal before returning a serving holder', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } })
		await fixture.server.start()
		let acquisition: Promise<unknown> | undefined
		const entered = Promise.withResolvers<void>()
		const hook = createHook({
			init: (_id, category, _trigger, resource: unknown) => {
				if (
					category !== 'PROMISE' ||
					!/at BrowserMCPServer\.#acquire/.test(new Error().stack ?? '')
				)
					return
				hook.disable()
				if (resource instanceof Promise) acquisition = resource
				entered.resolve()
			},
		}).enable()
		try {
			fixture.pair.send({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'acquire', arguments: { purpose: 'detached request' } },
			})
			// Observe the returned catalog before MCP removes the live request's cancellation handle.
			await entered.promise
			const catalog = await requireValue(acquisition).then((value: unknown) => {
				fixture.pair.send({
					jsonrpc: '2.0',
					method: 'notifications/cancelled',
					params: { requestId: 2 },
				})
				return value
			})
			if (!isString(catalog)) throw new Error('Missing catalog')
			const acquired = parseJSON(catalog)
			if (!isRecord(acquired)) throw new Error('Missing holder')
			expect(
				(
					await fixture.pair.call(3, 'execute', {
						holder: acquired['holder'],
						name: 'read',
						arguments: { from: 1, search: 'still serving' },
					})
				).error,
			).toBe(false)
		} finally {
			hook.disable()
			await fixture.teardown.destroy()
		}
	})

	it('aborts a holder call during refill and serves its next call', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } })
		const waiting = Promise.withResolvers<void>()
		let execution: Promise<unknown> | undefined
		const hook = createHook({
			init: (_id, category, _trigger, resource: unknown) => {
				if (
					category !== 'PROMISE' ||
					!/at BrowserMCPServer\.#perform/.test(new Error().stack ?? '')
				)
					return
				hook.disable()
				if (resource instanceof Promise) execution = resource
			},
		})
		try {
			await fixture.server.start()
			const acquired = parseJSON(
				(await fixture.pair.call(2, 'acquire', { purpose: 'refill cancellation' })).text,
			)
			if (!isRecord(acquired)) throw new Error('Missing holder')
			fixture.launcher.hold()
			requireValue(fixture.launcher.browsers[1]).kill()
			hook.enable()
			const grant = new BrowserPromiseObserver(
				/at BrowserMCPServer\.#grant/,
				undefined,
				waiting.resolve,
			)
			try {
				fixture.pair.send({
					jsonrpc: '2.0',
					id: 3,
					method: 'tools/call',
					params: {
						name: 'execute',
						arguments: {
							holder: acquired['holder'],
							name: 'read',
							arguments: { from: 1, search: 'waiting' },
						},
					},
				})
				await waiting.promise
				fixture.pair.send({
					jsonrpc: '2.0',
					method: 'notifications/cancelled',
					params: { requestId: 3 },
				})
				await expect(requireValue(execution)).rejects.toMatchObject({ name: 'AbortError' })
			} finally {
				grant.destroy()
			}
			fixture.launcher.release()
			const next = await fixture.pair.call(4, 'execute', {
				holder: acquired['holder'],
				name: 'read',
				arguments: { from: 1, search: 'after refill' },
			})
			expect(next.error).toBe(false)
			expect(next.text).toContain('BROWSER_SERVER_CRASH')
		} finally {
			hook.disable()
			fixture.launcher.release()
			await fixture.teardown.destroy()
		}
	})

	it('allocates references across real browser contexts and refuses a copied reference', async () => {
		const peers = await Promise.all([
			createCDPTestServer(),
			createCDPTestServer(),
			createCDPTestServer(),
		])
		const browsers = peers.map((peer) => createBrowser({ cdp: { endpoint: peer.endpoint } }))
		let launched = 0
		for (const peer of peers) {
			for (const method of [
				'Browser.getVersion',
				'Page.enable',
				'Runtime.enable',
				'WebMCP.enable',
				'WebMCP.disable',
				'Target.detachFromTarget',
				'Target.disposeBrowserContext',
				'Target.closeTarget',
				'Target.setDiscoverTargets',
				'Accessibility.enable',
				'DOM.enable',
			])
				peer.script(method, {})
			peer.script('Target.createBrowserContext', { browserContextId: 'isolated' })
			peer.script('Target.createTarget', { targetId: 'page' })
			peer.script('Target.attachToTarget', { sessionId: 'session' })
			peer.script('Page.createIsolatedWorld', { executionContextId: 1 })
			peer.script('Runtime.evaluate', (params: Readonly<Record<string, unknown>>) => ({
				result: { value: params['expression'] === 'document.readyState' ? 'complete' : true },
			}))
			peer.script('Accessibility.getFullAXTree', {
				nodes: [
					{
						nodeId: 'button',
						backendDOMNodeId: 3,
						role: { value: 'button' },
						name: { value: 'Checkout' },
						properties: [],
					},
				],
			})
		}
		const fixture = createBrowseFixture({
			pool: { contexts: 1, size: 3 },
			launch: () => requireValue(browsers[launched++]),
		})
		try {
			await fixture.server.start()
			const first = parseJSON(
				(await fixture.pair.call(2, 'acquire', { purpose: 'first page' })).text,
			)
			const second = parseJSON(
				(await fixture.pair.call(3, 'acquire', { purpose: 'second page' })).text,
			)
			if (!isRecord(first) || !isRecord(second)) throw new Error('Missing holders')
			const page = requireValue(browsers[1]?.contexts().at(-1)?.pages()[0])
			const other = requireValue(browsers[2]?.contexts().at(-1)?.pages()[0])
			const elements = await page.elements.find({ role: 'button' })
			const others = await other.elements.find({ role: 'button' })
			const ref = requireValue(elements[0]).reference
			expect(ref).not.toBe(requireValue(others[0]).reference)
			const refused = await fixture.pair.call(4, 'execute', {
				holder: second['holder'],
				name: 'click',
				arguments: { ref },
			})
			expect(refused.error).toBe(true)
			expect(refused.text).toContain(`Element ${ref} is not in the current view`)
			expect(
				peers[2]?.received.some((message) => message.method === 'Input.dispatchMouseEvent'),
			).toBe(false)
		} finally {
			await fixture.teardown.destroy()
			await Promise.all(peers.map((peer) => peer.close()))
		}
	})

	it('runs two holders concurrently on separate pages', async () => {
		const held = createRecorder<[CDPSentMessage]>()
		const fixture = createBrowseFixture(
			{ pool: { contexts: 1, size: 3 } },
			{
				evaluation: (message, transport) => {
					if (message.params?.['awaitPromise'] === true) held.handler(message)
					else transport.reply(message.id, { result: { value: true } })
				},
			},
		)
		try {
			await fixture.server.start()
			const first = parseJSON((await fixture.pair.call(2, 'acquire', { purpose: 'checkout' })).text)
			const second = parseJSON(
				(await fixture.pair.call(3, 'acquire', { purpose: 'inventory' })).text,
			)
			if (!isRecord(first) || !isRecord(second)) throw new Error('Missing holder catalogs')
			expect(first['holder']).not.toBe(second['holder'])
			expect(first['tools']).toEqual(
				expect.arrayContaining([expect.objectContaining({ name: 'read' })]),
			)
			fixture.pair.send(
				{
					jsonrpc: '2.0',
					id: 4,
					method: 'tools/call',
					params: {
						name: 'execute',
						arguments: { holder: first['holder'], name: 'wait', arguments: { text: 'first work' } },
					},
				},
				{
					jsonrpc: '2.0',
					id: 5,
					method: 'tools/call',
					params: {
						name: 'execute',
						arguments: {
							holder: second['holder'],
							name: 'wait',
							arguments: { text: 'second work' },
						},
					},
				},
			)
			await waitForCondition('both holder pages executing', () => held.count === 2)
			expect(fixture.pair.answered).not.toContain(4)
			expect(fixture.pair.answered).not.toContain(5)
			expect((await fixture.pair.call(6, 'read', { from: 1 })).error).toBe(false)
			for (const browser of fixture.launcher.browsers.slice(1)) {
				const transport = requireValue(browser.fixture?.transport)
				const message = requireValue(
					transport.sent.find((entry) => entry.params?.['awaitPromise'] === true),
				)
				transport.reply(message.id, { result: { value: true } })
			}
			expect((await fixture.pair.answer(4))['isError']).not.toBe(true)
			expect((await fixture.pair.answer(5))['isError']).not.toBe(true)
			expect(fixture.launcher.browsers).toHaveLength(3)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('refuses capacity synchronously with holder ids and purposes and launches nothing', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } })
		fixture.launcher.hold(1)
		try {
			await fixture.server.start()
			fixture.pair.send({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'acquire', arguments: { purpose: 'held checkout' } },
			})
			const busy = await fixture.pair.call(3, 'acquire', { purpose: 'overflow' })
			expect(busy.error).toBe(true)
			expect(busy.text).toMatch(/^BROWSER_SERVER_BUSY:/)
			expect(busy.text).toContain('shared (Shared browser)')
			expect(busy.text).toMatch(/[0-9a-f-]{36} \(held checkout\)/)
			expect(busy.text).toContain('destroy')
			expect(busy.text).toContain('named tools to share the shared browser')
			expect(fixture.pair.answered).not.toContain(2)
			fixture.launcher.release()
			expect((await fixture.pair.answer(2))['isError']).not.toBe(true)
		} finally {
			fixture.launcher.release()
			await fixture.teardown.destroy()
		}
	})

	it('counts a destroying holder and resolves its in-flight call as unresolved', async () => {
		const held = createRecorder<[CDPSentMessage]>()
		const fixture = createBrowseFixture(
			{ pool: { contexts: 1, size: 2 } },
			{
				registry: (message, transport) => transport.reply(message.id, {}),
				evaluation: (message, transport) => {
					if (message.params?.['awaitPromise'] === true) held.handler(message)
					else transport.reply(message.id, { result: { value: true } })
				},
			},
		)
		try {
			await fixture.server.start()
			const acquired = parseJSON(
				(await fixture.pair.call(2, 'acquire', { purpose: 'closing checkout' })).text,
			)
			if (!isRecord(acquired)) throw new Error('Missing holder')
			const holder = acquired['holder']
			const transport = requireValue(fixture.launcher.browsers[1]?.fixture?.transport)
			fixture.pair.send({
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/call',
				params: {
					name: 'execute',
					arguments: { holder, name: 'wait', arguments: { text: 'pending work' } },
				},
			})
			await waitForCondition('holder work entered', () => held.count === 1)
			const disposal = new BrowserPromiseObserver(/at BrowserMCPServer\.#release/, undefined, () =>
				fixture.pair.send({
					jsonrpc: '2.0',
					id: 5,
					method: 'tools/call',
					params: { name: 'acquire', arguments: { purpose: 'replacement' } },
				}),
			)
			try {
				fixture.pair.send({
					jsonrpc: '2.0',
					id: 4,
					method: 'tools/call',
					params: { name: 'destroy', arguments: { holder } },
				})
				const busy = JSON.stringify(await fixture.pair.answer(5))
				expect(busy).toContain(`${String(holder)} (closing checkout)`)
				expect(busy).toContain('BROWSER_SERVER_BUSY')
			} finally {
				disposal.destroy()
			}
			expect(JSON.stringify(await fixture.pair.answer(3))).toContain('BROWSER_SERVER_UNRESOLVED')
			expect(transport.sent.some((message) => message.params?.['awaitPromise'] === true)).toBe(true)
			expect((await fixture.pair.answer(4))['isError']).not.toBe(true)
			expect((await fixture.pair.call(6, 'destroy', { holder })).error).toBe(false)
			expect((await fixture.pair.call(7, 'acquire', { purpose: 'replacement' })).error).toBe(false)
		} finally {
			for (const browser of fixture.launcher.browsers) browser.fixture?.transport.closeRemote()
			await fixture.teardown.destroy()
		}
	})

	it('refuses unknown and ended handles without shared fallback and repeats destroy successfully', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } })
		try {
			await fixture.server.start()
			const acquired = parseJSON(
				(await fixture.pair.call(2, 'acquire', { purpose: 'temporary' })).text,
			)
			if (!isRecord(acquired)) throw new Error('Missing holder')
			const holder = acquired['holder']
			expect((await fixture.pair.call(3, 'destroy', { holder })).error).toBe(false)
			let id = 4
			for (const value of ['absent', holder, 'shared']) {
				for (const name of ['execute', 'tools']) {
					const result = await fixture.pair.call(id++, name, {
						holder: value,
						name: 'read',
						arguments: { from: 1, search: 'cart' },
					})
					expect(result.error).toBe(true)
					expect(result.text).toContain('BROWSER_SERVER_HOLDER')
				}
			}
			expect((await fixture.pair.call(id++, 'destroy', { holder: 'absent' })).error).toBe(true)
			expect((await fixture.pair.call(id++, 'destroy', {})).error).toBe(true)
			expect((await fixture.pair.call(id++, 'destroy', { holder })).error).toBe(false)
			expect(
				fixture.launcher.browsers[0]?.fixture?.transport.sent.some(
					(message) => message.method === 'Accessibility.getFullAXTree',
				),
			).toBe(false)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('cancels acquisition after pool commit and closes the undeliverable context', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } })
		await fixture.server.start()
		const committed = new BrowserPromiseObserver(/at Pool\.acquire/, () =>
			fixture.pair.send({
				jsonrpc: '2.0',
				method: 'notifications/cancelled',
				params: { requestId: 2 },
			}),
		)
		try {
			fixture.pair.send({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'acquire', arguments: { purpose: 'cancelled' } },
			})
			await waitForCondition(
				'cancelled request reached the pool',
				() => committed.resolved !== undefined,
			)
			expect(fixture.pair.answered).not.toContain(2)
			let id = 3
			const acquired = await retryUntil(
				'cancelled holder disposal settled',
				() => fixture.pair.call(id++, 'acquire', { purpose: 'replacement' }),
				(result) => !result.text.includes('BROWSER_SERVER_BUSY'),
			)
			expect(acquired.error).toBe(false)
			expect(fixture.launcher.browsers).toHaveLength(2)
		} finally {
			committed.destroy()
			await fixture.teardown.destroy()
		}
	})

	it('removes a cancelled acquisition while its browser is still warming', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } })
		fixture.launcher.hold(1)
		try {
			await fixture.server.start()
			fixture.pair.send({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'acquire', arguments: { purpose: 'cancelled' } },
			})
			expect((await fixture.pair.call(3, 'acquire', { purpose: 'capacity check' })).text).toContain(
				'BROWSER_SERVER_BUSY',
			)
			fixture.pair.send({
				jsonrpc: '2.0',
				method: 'notifications/cancelled',
				params: { requestId: 2 },
			})
			await fixture.pair.request(4, 'ping')
			fixture.launcher.release()
			expect((await fixture.pair.call(5, 'acquire', { purpose: 'replacement' })).error).toBe(false)
			expect(fixture.pair.answered).not.toContain(2)
		} finally {
			fixture.launcher.release()
			await fixture.teardown.destroy()
		}
	})

	it('keeps loss notices local and waits for an owed refill at full capacity', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 3 } })
		try {
			await fixture.server.start()
			const first = parseJSON((await fixture.pair.call(2, 'acquire', { purpose: 'checkout' })).text)
			const second = parseJSON(
				(await fixture.pair.call(3, 'acquire', { purpose: 'inventory' })).text,
			)
			if (!isRecord(first) || !isRecord(second)) throw new Error('Missing holders')
			fixture.launcher.hold()
			requireValue(fixture.launcher.browsers[1]).kill()
			fixture.pair.send({
				jsonrpc: '2.0',
				id: 4,
				method: 'tools/call',
				params: {
					name: 'execute',
					arguments: {
						holder: first['holder'],
						name: 'read',
						arguments: { from: 1, search: 'cart' },
					},
				},
			})
			await waitForCondition('owed refill launched', () => fixture.launcher.browsers.length === 4)
			const healthy = await fixture.pair.call(5, 'execute', {
				holder: second['holder'],
				name: 'read',
				arguments: { from: 1, search: 'cart' },
			})
			expect(healthy.error).toBe(false)
			expect(healthy.text).not.toContain('BROWSER_SERVER_CRASH')
			expect((await fixture.pair.call(6, 'read', { from: 1, search: 'cart' })).text).not.toContain(
				'BROWSER_SERVER_CRASH',
			)
			expect(fixture.pair.answered).not.toContain(4)
			fixture.launcher.release()
			expect(JSON.stringify(await fixture.pair.answer(4))).toContain('BROWSER_SERVER_CRASH')
			expect(
				(
					await fixture.pair.call(7, 'execute', {
						holder: first['holder'],
						name: 'read',
						arguments: { from: 1, search: 'cart' },
					})
				).text,
			).not.toContain('BROWSER_SERVER_CRASH')
		} finally {
			fixture.launcher.release()
			await fixture.teardown.destroy()
		}
	})

	it('scopes adopted tools and preserves a page tool parameter named holder', async () => {
		const fixture = createBrowseFixture(
			{ pool: { contexts: 1, size: 2 } },
			{ registry: (message, transport) => transport.reply(message.id, {}) },
		)
		try {
			await fixture.server.start()
			const acquired = parseJSON(
				(await fixture.pair.call(2, 'acquire', { purpose: 'catalog work' })).text,
			)
			if (!isRecord(acquired)) throw new Error('Missing holder')
			const holder = acquired['holder']
			const transport = requireValue(fixture.launcher.browsers[1]?.fixture?.transport)
			transport.onSend('WebMCP.invokeTool', (message) => {
				transport.reply(message.id, { invocationId: 'catalog-result' })
				transport.event(
					'WebMCP.toolResponded',
					{ invocationId: 'catalog-result', status: 'Completed', output: 'page result' },
					'session-main',
				)
			})
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search this holder', frameId: 'main' }] },
				'session-main',
			)
			await waitForCondition(
				'page tool adopted',
				() =>
					requireValue(fixture.launcher.browsers[1]?.context()?.pages()[0]).registry.tool(
						'search',
					) !== undefined,
			)
			const catalog = await fixture.pair.call(3, 'tools', { holder })
			expect(catalog.text).toContain('Search this holder')
			expect(JSON.stringify(await fixture.pair.request(4, 'tools/list'))).not.toContain(
				'Search this holder',
			)
			expect(
				(
					await fixture.pair.call(5, 'execute', {
						holder,
						name: 'search',
						arguments: { holder: 'page-owned-value' },
					})
				).error,
			).toBe(false)
			expect(
				transport.sent.find((message) => message.method === 'WebMCP.invokeTool')?.params,
			).toMatchObject({ input: { holder: 'page-owned-value' } })
		} finally {
			for (const browser of fixture.launcher.browsers) {
				const transport = browser.fixture?.transport
				if (transport !== undefined) replyOk(transport, 'WebMCP.disable')
			}
			await fixture.teardown.destroy()
		}
	})
})

describe('holders H2 continuations', () => {
	it('keeps the successor attached after an old token completes late', async () => {
		const version = Promise.withResolvers<void>()
		const entered = createRecorder<[]>()
		const fixture = createBrowseFixture(
			{ pool: { contexts: 1, size: 3 } },
			{
				version: (call) => {
					if (call !== 2) return
					entered.handler()
					return version.promise
				},
			},
		)
		try {
			await fixture.server.start()
			const acquired = parseJSON(
				(await fixture.pair.call(2, 'acquire', { purpose: 'recovering page' })).text,
			)
			if (!isRecord(acquired)) throw new Error('Missing holder')
			const holder = acquired['holder']
			const browser = requireValue(fixture.launcher.browsers[1])
			fixture.pair.send({
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/call',
				params: {
					name: 'execute',
					arguments: { holder, name: 'read', arguments: { from: 1, search: 'old call' } },
				},
			})
			await waitForCondition('old token ping entered', () => entered.count === 1)
			expect(fixture.pair.answered).not.toContain(3)
			browser.kill()
			const replacement = await fixture.pair.call(4, 'execute', {
				holder,
				name: 'read',
				arguments: { from: 1, search: 'successor' },
			})
			expect(replacement.error).toBe(false)
			const successor = requireValue(fixture.launcher.browsers[2])
			expect(
				successor.fixture?.transport.sent.some(
					(message) => message.method === 'Accessibility.getFullAXTree',
				),
			).toBe(true)
			version.resolve()
			await version.promise
			expect((await fixture.pair.answer(3))['isError']).not.toBe(true)
			expect(
				(
					await fixture.pair.call(5, 'execute', {
						holder,
						name: 'read',
						arguments: { from: 1, search: 'still attached' },
					})
				).error,
			).toBe(false)
			expect(successor.destroyed).toBe(false)
			expect(
				(await fixture.pair.call(6, 'read', { from: 1, search: 'shared' })).text,
			).not.toContain('BROWSER_SERVER_CRASH')
		} finally {
			version.resolve()
			await fixture.teardown.destroy()
		}
	})

	it('reserves the server names against shared page tools and obeys tool copy limits', async () => {
		const fixture = createBrowseFixture(undefined, {
			registry: (message, transport) => transport.reply(message.id, {}),
		})
		try {
			await fixture.server.start()
			const transport = requireValue(fixture.launcher.browsers[0]?.fixture?.transport)
			transport.event(
				'WebMCP.toolsAdded',
				{
					tools: Object.keys(BROWSER_SERVER_COPY).map((name) => ({
						name,
						description: 'Page replacement',
						frameId: 'main',
					})),
				},
				'session-main',
			)
			await waitForCondition(
				'reserved page tools arrived',
				() =>
					requireValue(fixture.launcher.browsers[0]?.context()?.pages()[0]).registry.tool(
						'acquire',
					) !== undefined,
			)
			const listed = await fixture.pair.request(2, 'tools/list')
			expect(JSON.stringify(listed)).not.toContain('Page replacement')
			for (const copy of Object.values(BROWSER_SERVER_COPY)) {
				expect(copy.description?.split(/\s+/).length).toBeLessThanOrEqual(25)
				const parameters = requireValue(copy.parameters)
				expect(parameters['required']).toEqual(expect.arrayContaining([expect.any(String)]))
				const properties = parameters['properties']
				if (!isRecord(properties)) throw new Error('Missing parameter properties')
				for (const property of Object.values(properties)) {
					if (!isRecord(property) || !isString(property['description']))
						throw new Error('Missing description')
					expect(property['description'].length).toBeLessThanOrEqual(100)
				}
			}
			expect(BROWSER_SERVER_COPY.execute.annotations?.pure).toBe(false)
			expect((await fixture.pair.call(3, 'acquire', { purpose: 'default capacity' })).error).toBe(
				false,
			)
		} finally {
			const transport = fixture.launcher.browsers[0]?.fixture?.transport
			if (transport !== undefined) replyOk(transport, 'WebMCP.disable')
			await fixture.teardown.destroy()
		}
	})
})

describe('eager U7', () => {
	for (const loss of ['drop', 'kill'] as const) {
		it(`reports the ${loss} cause using a test-owned live pid`, async () => {
			const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
				stdio: ['pipe', 'ignore', 'ignore'],
				windowsHide: true,
			})
			const pid = requireValue(child.pid, 'owned process')
			const fixture = createBrowseFixture(undefined, { pid })
			try {
				await fixture.server.start()
				const browser = requireValue(fixture.launcher.browsers[0], 'lease')
				expect(browser.pid).toBe(pid)
				if (loss === 'kill') {
					child.kill()
					await waitForProcessExit(pid)
				}
				browser[loss]()
				await waitForCondition(
					'loss watch settled',
					() => browser.emitter.count('disconnect') === 0,
				)
				const answer = await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })
				expect(answer.text).toContain(
					loss === 'drop'
						? 'BROWSER_SERVER_CRASH: The browser transport disconnected.'
						: 'BROWSER_SERVER_CRASH: The browser process exited.',
				)
			} finally {
				child.kill()
				await waitForProcessExit(pid)
				await fixture.teardown.destroy()
			}
		})
	}
	it('preserves a pending note when a call is cancelled inside the toolset', async () => {
		const held = createRecorder<[CDPSentMessage]>()
		const fixture = createBrowseFixture(
			{ pool: { contexts: 1, size: 2 } },
			{
				evaluation: (message, transport) => {
					if (message.params?.['awaitPromise'] === true) held.handler(message)
					else transport.reply(message.id, { result: { value: true } })
				},
			},
		)
		try {
			await fixture.server.start()
			requireValue(fixture.launcher.browsers[0], 'lease').kill()
			fixture.pair.send({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'wait', arguments: { text: 'held text' } },
			})
			await waitForCondition('cancelled call reached the toolset', () => held.count === 1)
			fixture.pair.send({
				jsonrpc: '2.0',
				method: 'notifications/cancelled',
				params: { requestId: 2 },
			})
			const transport = requireValue(
				fixture.launcher.browsers[1]?.fixture?.transport,
				'successor transport',
			)
			await waitForCondition('cancelled tool released its page script', () =>
				transport.sent.some(
					(message) =>
						isString(message.params?.['expression']) &&
						/^globalThis\["__browserTextWait\d+"\]\?\.\(\)$/u.test(message.params['expression']),
				),
			)
			const answer = await fixture.pair.call(3, 'read', { from: 1, search: 'cart' })
			expect(answer.error).toBe(false)
			expect(answer.text).toContain('BROWSER_SERVER_CRASH:')
			expect(fixture.pair.answered).not.toContain(2)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('refuses a recorded loss in the version continuation before hold', async () => {
		let pinged = false
		const fixture = createBrowseFixture(undefined, {
			version: () => {
				pinged = true
			},
		})
		const commit = new BrowserPromiseObserver(/at Pool\.acquire/, () =>
			fixture.launcher.browsers[0]?.kill(),
		)
		try {
			await expect(fixture.server.start()).rejects.toMatchObject({
				code: 'BROWSER_SERVER_UNAVAILABLE',
				message: 'The browser process exited.',
			})
			expect(pinged).toBe(true)
			expect(commit.resolved).toContain('Pool.#commit')
			expect(await fixture.pair.initialize()).toMatchObject({
				message: 'BROWSER_SERVER_UNAVAILABLE: The browser process exited.',
			})
			expect((await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })).error).toBe(true)
		} finally {
			commit.destroy()
			await fixture.teardown.destroy()
		}
	})

	it('carries every pending loss when a successor dies before its first outcome', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } })
		try {
			await fixture.server.start()
			const grant = new BrowserPromiseObserver(/at BrowserMCPServer\.#grant/, () =>
				fixture.launcher.browsers[1]?.kill(),
			)
			try {
				requireValue(fixture.launcher.browsers[0], 'first lease').kill()
				const answer = await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })
				expect(grant.resolved).toContain('BrowserMCPServer.#grant')
				expect(answer.error).toBe(true)
				expect(answer.text.match(/BROWSER_SERVER_CRASH:/g)).toHaveLength(2)
				expect(answer.text).toMatch(/\nBROWSER_SERVER_UNAVAILABLE:/)
				expect(
					(await fixture.pair.call(3, 'read', { from: 1, search: 'cart' })).text,
				).not.toContain('BROWSER_SERVER_CRASH')
			} finally {
				grant.destroy()
			}
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('keeps a completed click successful and notes the later loss', async () => {
		const fixture = createBrowseFixture()
		try {
			await fixture.server.start()
			await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })
			let delivered: boolean | undefined
			const result = new BrowserPromiseObserver(/at BrowserToolset\.#performManaged/, () => {
				delivered = fixture.pair.answered.includes(3)
				fixture.launcher.browsers[0]?.kill()
			})
			try {
				const clicked = await fixture.pair.call(3, 'click', { ref: 'e4' })
				expect(result.resolved).toContain('BrowserToolset.#performManaged')
				expect(delivered).toBe(false)
				expect(clicked.error).toBe(false)
				expect(clicked.text).toContain('Clicked e4')
				await waitForCondition(
					'browser disposal after generation cleanup',
					() => fixture.launcher.browsers[0]?.destroyed === true,
				)
				expect(fixture.launcher.browsers[0]?.destroyed).toBe(true)
				expect(clicked.text).not.toContain('UNRESOLVED')
				expect((await fixture.pair.call(4, 'read', { from: 1, search: 'cart' })).text).toMatch(
					/BROWSER_SERVER_CRASH:/,
				)
			} finally {
				result.destroy()
			}
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('unmirrors adopted tools when the lease is lost', async () => {
		const fixture = createBrowseFixture(undefined, {
			registry: (message, transport) => transport.reply(message.id, {}),
		})
		try {
			await fixture.server.start()
			const browser = requireValue(fixture.launcher.browsers[0], 'lease')
			const transport = requireValue(browser.fixture?.transport, 'transport')
			replyOk(transport, 'WebMCP.disable')
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search the catalog', frameId: 'main' }] },
				'session-main',
			)
			await waitForCondition('adopted search dispatcher', async () =>
				JSON.stringify(await fixture.pair.request(2, 'tools/list')).includes('Search the catalog'),
			)
			browser.kill()
			expect(JSON.stringify(await fixture.pair.request(3, 'tools/list'))).not.toContain(
				'Search the catalog',
			)
		} finally {
			await fixture.teardown.destroy()
		}
	})
	it('classifies an in-call transport drop with the post-failure ping', async () => {
		const fixture = createBrowseFixture(undefined, {
			evaluation: () => requireValue(fixture.launcher.browsers[0], 'lease').drop(),
		})
		try {
			await fixture.server.start()
			const answer = await fixture.pair.call(2, 'wait', { text: 'never arrives' })
			expect(answer.text).toMatch(/^BROWSER_SERVER_UNRESOLVED:/)
			expect(answer.text).toContain('The outcome is unknown')
			expect(answer.text).toContain('Browse did not repeat the call')
			const next = await fixture.pair.call(3, 'read', { from: 1, search: 'cart' })
			expect(next.error).toBe(false)
			expect(next.text).toContain('BROWSER_SERVER_CRASH:')
			expect(fixture.launcher.browsers).toHaveLength(2)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('keeps an unknown reference a known failure with no loss or launch', async () => {
		const fixture = createBrowseFixture()
		try {
			await fixture.server.start()
			const result = await fixture.pair.call(2, 'click', { ref: 'e9999' })
			expect(result.error).toBe(true)
			expect(result.text).not.toContain('BROWSER_SERVER_')
			expect(fixture.launcher.browsers).toHaveLength(1)
			expect((await fixture.pair.call(3, 'read', { from: 1, search: 'cart' })).text).not.toContain(
				'BROWSER_SERVER_CRASH',
			)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('unwatches a silent hand-out validation without a process kill', async () => {
		const fixture = createBrowseFixture(
			{ pool: { contexts: 1, size: 2 } },
			{ silent: 1, timeout: 30 },
		)
		try {
			await fixture.server.start()
			const lost = requireValue(fixture.launcher.browsers[0], 'lost')
			const context = requireValue(lost.context(), 'context')
			const page = requireValue(context.pages()[0], 'page')
			expect(lost.pid).toBeUndefined()
			expect(lost.emitter.count('disconnect')).toBe(0)
			expect(context.emitter.count('page')).toBe(0)
			expect(page.emitter.count('crash')).toBe(0)
			await waitForCondition('validation refill', () => fixture.launcher.browsers.length === 3)
			expect((await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })).error).toBe(false)
			expect(
				fixture.launcher.browsers[1]?.fixture?.transport.sent.some(
					(message) => message.method === 'Accessibility.getFullAXTree',
				),
			).toBe(true)
			await fixture.server.destroy()
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('unwatches token destruction and annotates the spare result', async () => {
		const fixture = createBrowseFixture(
			{ pool: { contexts: 1, size: 2 } },
			{
				version: (call) => {
					if (call === 2) throw new Error('second ping refused')
				},
			},
		)
		try {
			await fixture.server.start()
			const lost = requireValue(fixture.launcher.browsers[0], 'lease')
			const context = requireValue(lost.context(), 'context')
			const page = requireValue(context.pages()[0], 'page')
			expect(lost.emitter.count('disconnect')).toBe(1)
			expect(page.emitter.count('crash')).toBe(1)
			const answer = await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })
			expect(answer.error).toBe(false)
			expect(answer.text).toMatch(/BROWSER_SERVER_CRASH: second ping refused/)
			expect(lost.emitter.count('disconnect')).toBe(0)
			expect(context.emitter.count('page')).toBe(0)
			expect(page.emitter.count('crash')).toBe(0)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('unwatches every slot when the pool is destroyed', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } })
		try {
			await fixture.server.start()
			await waitForCondition(
				'spare watch',
				() => fixture.launcher.browsers[1]?.emitter.count('disconnect') === 1,
			)
			await fixture.server.destroy()
			for (const browser of fixture.launcher.browsers) {
				expect(browser.emitter.count('disconnect')).toBe(0)
				for (const context of browser.contexts()) {
					expect(context.emitter.count('page')).toBe(0)
					for (const page of context.pages()) expect(page.emitter.count('crash')).toBe(0)
				}
			}
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('never arms a watch for a failed warm', async () => {
		const fixture = createBrowseFixture(undefined, { broken: 2 })
		try {
			await expect(fixture.server.start()).rejects.toThrow('refused isolation')
			expect(fixture.launcher.browsers).toHaveLength(2)
			for (const browser of fixture.launcher.browsers) {
				expect(browser.emitter.count('disconnect')).toBe(0)
				expect(browser.contexts()).toEqual([])
			}
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('keeps late page listeners in the map until loss', async () => {
		const fixture = createBrowseFixture()
		try {
			await fixture.server.start()
			const browser = requireValue(fixture.launcher.browsers[0], 'lease')
			const context = requireValue(browser.context(), 'context')
			const late = await context.create()
			expect(context.pages()).toContain(late)
			expect(late.emitter.count('crash')).toBe(1)
			late.emitter.emit('crash')
			const answer = await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })
			expect(answer.text).not.toContain('BROWSER_SERVER_CRASH:')
			expect(browser.destroyed).toBe(false)
			browser.kill()
			expect(late.emitter.count('crash')).toBe(0)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('owes one attempt before release and refills after the grant resets strikes', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } })
		try {
			await fixture.server.start()
			await waitForCondition(
				'first spare watch',
				() => fixture.launcher.browsers[1]?.emitter.count('disconnect') === 1,
			)
			requireValue(fixture.launcher.browsers[1], 'spare').kill()
			await waitForCondition(
				'replacement spare watch',
				() => fixture.launcher.browsers[2]?.emitter.count('disconnect') === 1,
			)
			requireValue(fixture.launcher.browsers[2], 'replacement spare').kill()
			await waitForCondition(
				'spent spare disposal',
				() => fixture.launcher.browsers[2]?.destroyed === true,
			)
			await waitForCondition(
				'spent spare profile removed',
				() =>
					!existsSync(
						requireValue(fixture.launcher.browsers[2]?.options.profile, 'spent spare profile'),
					),
			)
			await fixture.pair.request(10, 'ping')
			expect(fixture.launcher.browsers).toHaveLength(3)
			fixture.launcher.hold()
			requireValue(fixture.launcher.browsers[0], 'lease').kill()
			const call = fixture.pair.call(2, 'read', { from: 1, search: 'cart' })
			await waitForCondition('owed held launch', () => fixture.launcher.browsers.length === 4)
			expect(fixture.pair.answered).not.toContain(2)
			expect(fixture.launcher.browsers).toHaveLength(4)
			fixture.launcher.release()
			const result = await call
			expect(result.error).toBe(false)
			expect(result.text).toContain('BROWSER_SERVER_CRASH:')
			await waitForCondition(
				'T2 grant reset refills the floor',
				() => fixture.launcher.browsers.length === 5,
			)
		} finally {
			fixture.launcher.release()
			await fixture.teardown.destroy()
		}
	})

	it('retains a size one survivor and rechecks its profile on input end', async () => {
		const fixture = createBrowseFixture(undefined, { survivors: 1 })
		const exit = process.exitCode
		try {
			await fixture.server.start()
			const browser = requireValue(fixture.launcher.browsers[0], 'lease')
			const profile = requireValue(browser.options.profile, 'profile')
			browser.kill()
			const answer = await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })
			expect(answer.error).toBe(true)
			expect(answer.text).toContain('BROWSER_SERVER_CRASH:')
			expect(answer.text).toMatch(/\nBROWSER_SERVER_UNAVAILABLE:.*termination is unconfirmed/)
			expect(fixture.launcher.browsers).toHaveLength(1)
			expect(existsSync(profile)).toBe(true)
			fixture.pair.input.end()
			await waitForCondition('input ending reports teardown', () => process.exitCode === 1)
			await expect(fixture.server.destroy()).rejects.toMatchObject({
				errors: [expect.objectContaining({ message: 'The fixture termination is unconfirmed' })],
			})
			expect(existsSync(profile)).toBe(false)
			expect(fixture.log.lines.filter((line) => line.includes('TEARDOWN'))).toHaveLength(2)
		} finally {
			process.exitCode = exit
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})

	it('serves on the spare beside a retained size two survivor without launching', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } }, { survivors: 1 })
		try {
			await fixture.server.start()
			await waitForCondition(
				'spare watch',
				() => fixture.launcher.browsers[1]?.emitter.count('disconnect') === 1,
			)
			requireValue(fixture.launcher.browsers[0], 'lease').kill()
			const result = await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })
			expect(result.error).toBe(false)
			expect(result.text).toContain('BROWSER_SERVER_CRASH:')
			expect(fixture.launcher.browsers).toHaveLength(2)
			expect(fixture.log.lines.filter((line) => line.includes('TEARDOWN'))).toHaveLength(1)
			await expect(fixture.server.destroy()).rejects.toThrow('teardown failed')
		} finally {
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})

	it('refuses every later warm after a stranded launch', async () => {
		const fixture = createBrowseFixture(undefined, { survivors: 1, broken: 1 })
		try {
			await expect(fixture.server.start()).rejects.toMatchObject({
				code: 'BROWSER_SERVER_UNAVAILABLE',
				message: 'The fixture termination is unconfirmed.',
			})
			const initialized = await fixture.pair.initialize()
			expect(initialized).toMatchObject({
				message: 'BROWSER_SERVER_UNAVAILABLE: The fixture termination is unconfirmed.',
			})
			expect(fixture.launcher.browsers).toHaveLength(1)
			await expect(fixture.server.destroy()).rejects.toMatchObject({
				errors: [expect.objectContaining({ message: 'The fixture termination is unconfirmed' })],
			})
		} finally {
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})

	it('keeps concurrent unresolved work separate from the successor note', async () => {
		const held = createRecorder<[CDPSentMessage]>()
		const fixture = createBrowseFixture(
			{ pool: { contexts: 1, size: 2 } },
			{ evaluation: held.handler },
		)
		try {
			await fixture.server.start()
			const pending = fixture.pair.call(2, 'wait', { text: 'held text' })
			await waitForCondition('held wait evaluation', () => held.count > 0)
			requireValue(fixture.launcher.browsers[0], 'lease').kill()
			const next = await fixture.pair.call(3, 'read', { from: 1, search: 'cart' })
			expect(next.text).toContain('BROWSER_SERVER_CRASH:')
			expect((await pending).text).toMatch(/^BROWSER_SERVER_UNRESOLVED:/)
			expect((await fixture.pair.call(4, 'read', { from: 1, search: 'cart' })).text).not.toContain(
				'BROWSER_SERVER_CRASH',
			)
		} finally {
			await fixture.teardown.destroy()
		}
	})
})

describe('eager U6', () => {
	it('gates the handshake and a modern call while ping and list answer', async () => {
		const fixture = createBrowseFixture()
		const { launcher, server, pair } = fixture
		launcher.hold()
		const starting = server.start()
		try {
			const initialized = pair.initialize()
			pair.send({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: {
					name: 'read',
					arguments: { from: 1, search: 'cart' },
					_meta: {
						'io.modelcontextprotocol/protocolVersion': MCP_MODERN_VERSION,
						'io.modelcontextprotocol/clientCapabilities': {},
					},
				},
			})
			expect(await pair.request(3, 'ping')).toEqual({})
			expect((await pair.request(4, 'tools/list'))['tools']).toBeInstanceOf(Array)
			await waitForCondition('held launch', () => launcher.browsers.length === 1)
			expect(pair.answered).not.toContain(1)
			expect(pair.answered).not.toContain(2)
			launcher.release()
			await starting
			expect(await initialized).toHaveProperty('serverInfo')
			expect(await pair.answer(2)).not.toHaveProperty('isError', true)
			expect(launcher.browsers).toHaveLength(1)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('answers initialize while the second launch remains held', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } })
		fixture.launcher.hold(1)
		const starting = fixture.server.start()
		try {
			await starting
			expect(await fixture.pair.initialize()).toHaveProperty('serverInfo')
			await waitForCondition('held spare', () => fixture.launcher.browsers.length === 2)
			expect(fixture.launcher.browsers[1]?.fixture).toBeUndefined()
		} finally {
			await fixture.teardown.destroy()
		}
	})

	for (const size of [1, 2, 3]) {
		it(`refuses startup at size ${size} after exactly two failed launches`, async () => {
			const fixture = createBrowseFixture(
				{ pool: { contexts: 1, size } },
				{ failures: size === 1 ? 2 : 20 },
			)
			try {
				await expect(fixture.server.start()).rejects.toMatchObject({
					code: 'BROWSER_SERVER_UNAVAILABLE',
					message: expect.stringContaining('The fixture refused the launch'),
				})
				const initialized = await fixture.pair.initialize()
				expect(initialized).toMatchObject({
					code: -32000,
					data: { code: 'BROWSER_SERVER_UNAVAILABLE' },
				})
				expect(JSON.stringify(initialized).match(/The fixture refused the launch/g)).toHaveLength(1)
				const answer = await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })
				expect(answer.error).toBe(true)
				expect(answer.text.match(/BROWSER_SERVER_UNAVAILABLE/g)).toHaveLength(1)
				expect(answer.text.match(/The fixture refused the launch/g)).toHaveLength(1)
				const modern = await fixture.pair.request(3, 'tools/call', {
					name: 'read',
					arguments: { from: 1, search: 'cart' },
					_meta: {
						'io.modelcontextprotocol/protocolVersion': MCP_MODERN_VERSION,
						'io.modelcontextprotocol/clientCapabilities': {},
					},
				})
				expect(JSON.stringify(modern).match(/BROWSER_SERVER_UNAVAILABLE/g)).toHaveLength(1)
				expect(JSON.stringify(modern).match(/The fixture refused the launch/g)).toHaveLength(1)
				expect(fixture.launcher.browsers).toHaveLength(2)
				expect(fixture.log.lines).toEqual([
					'browse: BROWSER_SERVER_LAUNCH: The fixture refused the launch.\n',
					'browse: BROWSER_SERVER_LAUNCH: The fixture refused the launch.\n',
				])
			} finally {
				await fixture.teardown.destroy()
			}
		})
	}

	it('logs launch failures without exhausted when a post-setup spare spends the bound', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } })
		try {
			await fixture.server.start()
			await waitForCondition(
				'warm spare watch',
				() => fixture.launcher.browsers[1]?.emitter.count('disconnect') === 1,
			)
			expect(await fixture.pair.initialize()).toHaveProperty('serverInfo')
			expect(fixture.log.lines).toEqual([])
			fixture.launcher.refuse(2)
			requireValue(fixture.launcher.browsers[1], 'spare').kill()
			await waitForCondition(
				'post-setup replacement bound spent',
				() =>
					fixture.log.lines.filter((line) => line.includes('BROWSER_SERVER_LAUNCH:')).length === 1,
			)
			expect((await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })).error).toBe(false)
			expect(fixture.launcher.browsers).toHaveLength(3)
			expect(fixture.launcher.browsers[0]?.destroyed).toBe(false)
			expect(fixture.log.lines.filter((line) => line.includes('BROWSER_SERVER_LAUNCH:'))).toEqual([
				'browse: BROWSER_SERVER_LAUNCH: The fixture refused the launch.\n',
			])
			expect(
				fixture.log.lines.filter((line) => line.includes('BROWSER_SERVER_EXHAUSTED:')),
			).toEqual([])
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('reports exhausted spares with the grant committed first', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } })
		fixture.launcher.refuse(1)
		fixture.launcher.hold(1)
		try {
			await fixture.server.start()
			fixture.launcher.release()
			await waitForCondition('exhausted floor', () =>
				fixture.log.lines.some((line) => line.includes('EXHAUSTED')),
			)
			expect(fixture.launcher.browsers).toHaveLength(3)
			expect(fixture.log.lines.filter((line) => line.includes('EXHAUSTED'))).toHaveLength(1)
			expect(fixture.log.lines.filter((line) => line.includes('BROWSER_SERVER_LAUNCH:'))).toEqual([
				'browse: BROWSER_SERVER_LAUNCH: The fixture refused the launch.\n',
				'browse: BROWSER_SERVER_LAUNCH: The fixture refused the launch.\n',
			])
			expect(fixture.log.lines.some((line) => line.includes('BROWSER_SERVER_UNAVAILABLE:'))).toBe(
				false,
			)
			expect((await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })).error).toBe(false)
			expect(fixture.launcher.browsers[0]?.destroyed).toBe(false)
		} finally {
			await fixture.teardown.destroy()
		}
	})
	it('names a pid-bearing launch failure in the unavailable response', async () => {
		const failure = new BrowserError('termination unconfirmed', 'BROWSER_FIXTURE', {
			pid: process.pid,
		})
		const fixture = createBrowseFixture({
			launch: () => {
				throw failure
			},
		})
		try {
			await expect(fixture.server.start()).rejects.toThrow(`pid ${process.pid}`)
			expect((await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })).text).toContain(
				`pid ${process.pid}`,
			)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('keeps the floor spent when the first grant follows both spare refusals', async () => {
		// The first browser was created before both refusals, so its grant does not reopen the bound.
		const version = Promise.withResolvers<void>()
		const fixture = createBrowseFixture(
			{ pool: { contexts: 1, size: 2 } },
			{ version: () => version.promise },
		)
		fixture.launcher.refuse(1)
		const starting = fixture.server.start()
		try {
			await waitForCondition(
				'both spare refusals',
				() =>
					fixture.log.lines.filter((line) => line.includes('BROWSER_SERVER_LAUNCH:')).length === 2,
			)
			expect(fixture.launcher.browsers).toHaveLength(3)
			version.resolve()
			await starting
			await waitForCondition('exhausted report', () =>
				fixture.log.lines.some((line) => line.includes('EXHAUSTED')),
			)
			await fixture.pair.request(10, 'ping')
			expect(fixture.launcher.browsers).toHaveLength(3)
			expect(fixture.log.lines.filter((line) => line.includes('EXHAUSTED'))).toHaveLength(1)
			expect(
				fixture.log.lines.filter((line) => line.includes('BROWSER_SERVER_LAUNCH:')),
			).toHaveLength(2)
			expect(fixture.log.lines.some((line) => line.includes('BROWSER_SERVER_UNAVAILABLE:'))).toBe(
				false,
			)
		} finally {
			version.resolve()
			await fixture.teardown.destroy()
		}
	})

	it('never starts the pool again on demand after its bound is spent', async () => {
		const fixture = createBrowseFixture(undefined, {
			version: (call) => {
				if (call > 1) throw new Error('ping refused')
			},
		})
		fixture.launcher.refuse(1)
		try {
			await fixture.server.start()
			for (const id of [2, 3, 4]) {
				expect((await fixture.pair.call(id, 'read', { from: 1, search: 'cart' })).text).toMatch(
					/^BROWSER_SERVER_UNAVAILABLE:/m,
				)
				expect(fixture.launcher.browsers).toHaveLength(3)
			}
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('makes one acquire per call without pinging the acquired browser again', async () => {
		const fixture = createBrowseFixture(undefined, {
			version: (call) => {
				if (call > 1) throw new Error('ping refused')
			},
		})
		try {
			await fixture.server.start()
			for (const id of [2, 3, 4]) {
				const before = fixture.launcher.browsers.length
				expect((await fixture.pair.call(id, 'read', { from: 1, search: 'cart' })).error).toBe(false)
				expect(fixture.launcher.browsers.length - before).toBe(1)
			}
		} finally {
			await fixture.teardown.destroy()
		}
	})
	it('shares one failover acquire between concurrent calls and leaves the refill blank', async () => {
		const fixture = createBrowseFixture({ pool: { contexts: 1, size: 2 } })
		try {
			await fixture.server.start()
			await waitForCondition(
				'warm spare',
				() => fixture.launcher.browsers[1]?.fixture !== undefined,
			)
			await requireValue(fixture.launcher.browsers[0], 'lease').disconnect()
			const replies = await Promise.all([
				fixture.pair.call(2, 'read', { from: 1 }),
				fixture.pair.call(3, 'read', { from: 1, search: 'cart' }),
			])
			expect(replies.every((reply) => !reply.error)).toBe(true)
			await waitForCondition(
				'refill page',
				() => fixture.launcher.browsers[2]?.fixture !== undefined,
			)
			const spare = requireValue(fixture.launcher.browsers[1]?.fixture, 'adopted spare')
			const refill = requireValue(fixture.launcher.browsers[2], 'refill')
			expect(
				spare.transport.sent.some((message) => message.method === 'Accessibility.getFullAXTree'),
			).toBe(true)
			await waitForCondition('refill page published', () => refill.context()?.pages().length === 1)
			expect(refill.context()?.pages()[0]?.url).toBe('about:blank')
			expect(fixture.launcher.browsers).toHaveLength(3)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	for (const size of [0, 4, 1.5, -1, NaN, Infinity]) {
		it(`refuses pool size ${size}`, () => {
			expect(() => createBrowserMCPServer({ pool: { contexts: 1, size } })).toThrow(
				expect.objectContaining({ code: 'BROWSER_SERVER_OPTIONS' }),
			)
		})
	}

	it('destroys during a held connect without releasing it or writing afterward', async () => {
		const fixture = createBrowseFixture()
		fixture.launcher.hold()
		const starting = fixture.server.start()
		try {
			fixture.pair.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
			await waitForCondition('held connect', () => fixture.launcher.browsers[0]?.connects === 1)
			await fixture.server.destroy()
			await starting
			expect(fixture.pair.answered).toEqual([])
			expect(fixture.log.lines).toEqual([])
			expect(readdirSync(join(fixture.root, '.profiles'))).toEqual([])
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('destroys during a hand-out ping without refilling', async () => {
		const version = Promise.withResolvers<void>()
		let pinged = false
		const fixture = createBrowseFixture(undefined, {
			version: () => {
				pinged = true
				return version.promise
			},
		})
		const starting = fixture.server.start()
		try {
			await waitForCondition('hand-out ping', () => pinged)
			await fixture.server.destroy()
			await starting
			expect(fixture.launcher.browsers).toHaveLength(1)
			expect(readdirSync(join(fixture.root, '.profiles'))).toEqual([])
		} finally {
			version.resolve()
			await fixture.teardown.destroy()
		}
	})

	it('closes in one turn without sweeping an exited owner or attaching listeners', async () => {
		const fixture = createBrowseFixture()
		const owner = readExitedProcessId()
		const folder = fixture.scratch.ensure(
			join('browsers', '.profiles', formatBrowserLockEntry(owner, randomUUID())),
		)
		const listeners = process.listenerCount('SIGTERM')
		try {
			await Promise.all([fixture.server.start(), fixture.server.destroy()])
			expect(fixture.launcher.browsers).toEqual([])
			expect(existsSync(folder)).toBe(true)
			expect(process.listenerCount('SIGTERM')).toBe(listeners)
			expect(fixture.pair.input.listenerCount('end')).toBe(0)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('destroys a never-started server without listing an absent profiles directory', async () => {
		const fixture = createBrowseFixture()
		try {
			await fixture.server.destroy()
			expect(existsSync(fixture.root)).toBe(false)
			await expect(fixture.server.start()).rejects.toMatchObject({ code: 'BROWSER_TOOLSET_ENDED' })
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('refuses calls after unusable-root setup instead of parking on an unstarted pool', async () => {
		const scratch = createScratch()
		const root = scratch.write('file', 'regular file')
		const code = await mkdir(join(root, '.profiles'), { recursive: true }).then(
			() => undefined,
			readErrorCode,
		)
		expect(typeof code).toBe('string')
		const fixture = createBrowseFixture({ root })
		try {
			await expect(fixture.server.start()).rejects.toThrow(String(code))
			expect(await fixture.pair.initialize()).toMatchObject({
				code: -32000,
				data: { code: 'BROWSER_SERVER_UNAVAILABLE' },
			})
			const answer = await fixture.pair.request(2, 'tools/call', {
				name: 'read',
				arguments: { from: 1, search: 'cart' },
				_meta: {
					'io.modelcontextprotocol/protocolVersion': MCP_MODERN_VERSION,
					'io.modelcontextprotocol/clientCapabilities': {},
				},
			})
			expect(JSON.stringify(answer)).toContain('BROWSER_SERVER_UNAVAILABLE:')
			await fixture.server.destroy()
		} finally {
			await fixture.teardown.destroy()
			scratch.destroy()
		}
	})

	it('sweeps missing records and parsed records whose browser pid is gone', async () => {
		const fixture = createBrowseFixture()
		const pid = readExitedProcessId()
		const absent = fixture.scratch.ensure(
			`browsers/.profiles/${formatBrowserLockEntry(pid, '11111111-1111-4111-8111-111111111111')}`,
		)
		const gone = fixture.scratch.ensure(
			`browsers/.profiles/${formatBrowserLockEntry(pid, '22222222-2222-4222-8222-222222222222')}`,
		)
		writeFileSync(
			join(gone, BROWSER_SERVER_RECORD),
			JSON.stringify({ pid, endpoint: 'ws://127.0.0.1:12345/devtools/browser/gone' }),
		)
		const legacy = fixture.scratch.ensure('browsers/.profiles/33333333-3333-4333-8333-333333333333')
		const live = fixture.scratch.ensure(
			`browsers/.profiles/${formatBrowserLockEntry(process.pid, '44444444-4444-4444-8444-444444444444')}`,
		)
		try {
			await fixture.server.start()
			await waitForCondition(
				'removed stale folders',
				() => !existsSync(absent) && !existsSync(gone),
			)
			expect(existsSync(legacy)).toBe(true)
			expect(existsSync(live)).toBe(true)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('keeps unreadable and non-loopback records', async () => {
		const fixture = createBrowseFixture()
		const peer = await createCDPTestServer()
		peer.script('Browser.close', {})
		const pid = readExitedProcessId()
		const unreadable = fixture.scratch.ensure(
			`browsers/.profiles/${formatBrowserLockEntry(pid, '11111111-1111-4111-8111-111111111111')}`,
		)
		mkdirSync(join(unreadable, BROWSER_SERVER_RECORD))
		const refused = fixture.scratch.ensure(
			`browsers/.profiles/${formatBrowserLockEntry(pid, '22222222-2222-4222-8222-222222222222')}`,
		)
		writeFileSync(
			join(refused, BROWSER_SERVER_RECORD),
			JSON.stringify({
				pid: process.pid,
				endpoint: peer.endpoint
					.replace('127.0.0.1', 'localhost')
					.replace('/cdp', '/devtools/browser/foreign'),
			}),
		)
		const marker = fixture.scratch.ensure(
			`browsers/.profiles/${formatBrowserLockEntry(pid, '33333333-3333-4333-8333-333333333333')}`,
		)
		const order = readdirSync(dirname(marker))
		expect(order.indexOf(basename(marker))).toBeGreaterThan(order.indexOf(basename(refused)))
		try {
			await fixture.server.start()
			await waitForCondition('sweep passed the refused record', () => !existsSync(marker))
			await fixture.server.destroy()
			expect(existsSync(unreadable)).toBe(true)
			expect(existsSync(refused)).toBe(true)
			expect(peer.received).toEqual([])
		} finally {
			await fixture.teardown.destroy()
			await peer.close()
		}
	})
	it('reports only a persistent folder removal failure at shutdown', async (context) => {
		const probe = createScratch()
		const directory = probe.ensure('held')
		const holder = spawn(process.execPath, ['-e', 'console.log("ready");process.stdin.resume()'], {
			cwd: directory,
			stdio: ['pipe', 'pipe', 'ignore'],
			windowsHide: true,
		})
		const owner = requireValue(holder.pid, 'probe owner')
		let code: string | undefined
		try {
			await waitForEvent<[Buffer]>((listener) => {
				holder.stdout?.once('data', listener)
				return () => holder.stdout?.off('data', listener)
			}, 'probe holds its current directory')
			try {
				await rm(directory, { recursive: true, force: true, maxRetries: 5 })
			} catch (error) {
				code = readErrorCode(error)
			}
		} finally {
			holder.kill()
			await waitForProcessExit(owner)
			probe.destroy()
		}
		context.skip(
			code === undefined,
			'NOT-EVIDENCED: the host permits removal of a live child current directory',
		)
		for (const persistent of [false, true]) {
			const fixture = createBrowseFixture()
			try {
				await fixture.server.start()
				const browser = requireValue(fixture.launcher.browsers[0], 'lease')
				const folder = requireValue(browser.options.profile, 'profile')
				const child = spawn(
					process.execPath,
					['-e', 'console.log("ready");process.stdin.resume()'],
					{
						cwd: folder,
						stdio: ['pipe', 'pipe', 'ignore'],
					},
				)
				const pid = requireValue(child.pid, 'folder holder')
				try {
					await waitForEvent<[Buffer]>((listener) => {
						child.stdout?.once('data', listener)
						return () => child.stdout?.off('data', listener)
					}, 'child holds profile directory')
					await browser.disconnect()
					expect((await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })).error).toBe(
						false,
					)
					expect(existsSync(folder)).toBe(true)
					if (!persistent) {
						child.stdin?.end()
						await waitForProcessExit(pid)
					}
					const failure = await fixture.server.destroy().then(
						() => undefined,
						(error: unknown) => error,
					)
					const expected = expect.objectContaining({
						errors: expect.arrayContaining([expect.objectContaining({ code })]),
					})
					expect(failure).toEqual(persistent ? expected : undefined)
					expect(existsSync(folder)).toBe(persistent)
				} finally {
					child.kill()
					await waitForProcessExit(pid)
				}
			} finally {
				await fixture.teardown.destroy().catch(() => undefined)
			}
		}
	}, 15000)
	it('cancels a per-call ping without losing the held browser or answering the request', async () => {
		const held = Promise.withResolvers<void>()
		let calls = 0
		const fixture = createBrowseFixture(undefined, {
			version: (call) => {
				calls = call
				if (call === 2) return held.promise
			},
		})
		try {
			await fixture.server.start()
			fixture.pair.send({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'read', arguments: { from: 1, search: 'cart' } },
			})
			await waitForCondition('held per-call ping', () => calls === 2)
			fixture.pair.send({
				jsonrpc: '2.0',
				method: 'notifications/cancelled',
				params: { requestId: 2, reason: 'caller stopped' },
			})
			await fixture.pair.request(3, 'ping')
			held.resolve()
			expect((await fixture.pair.call(4, 'read', { from: 1, search: 'cart' })).error).toBe(false)
			expect(fixture.pair.answered).not.toContain(2)
			expect(fixture.launcher.browsers).toHaveLength(1)
			expect(fixture.launcher.browsers[0]?.destroyed).toBe(false)
		} finally {
			held.resolve()
			await fixture.teardown.destroy()
		}
	})
	it('keeps a cancelled post-failure ping and joins its remaining deadline', async () => {
		const held = Promise.withResolvers<void>()
		// Leave half the real command budget spent before the next call joins it.
		const timeout = 800
		const fixture = createBrowseFixture(undefined, {
			timeout,
			version: (call) => {
				if (call >= 3) return held.promise
			},
		})
		const client = createMCPClient({
			transport: createDuplexClientTransport(fixture.pair.transport),
			identity: { name: 'cancelled-ping', version: '1.0.0' },
		})
		fixture.teardown.add(bindClient(client, fixture.pair.transport))
		const controller = new AbortController()
		try {
			await fixture.server.start()
			await client.connect()
			const transport = requireValue(fixture.launcher.browsers[0]?.fixture?.transport, 'lease')
			const pending = client.call('click', { ref: 'e9999' }, { signal: controller.signal })
			await waitForCondition(
				'post-failure ping',
				() =>
					transport.sent.filter((message) => message.method === 'Browser.getVersion').length === 3,
			)
			const began = performance.now()
			const reason = new Error('caller stopped during loss check')
			controller.abort(reason)
			await expect(pending).rejects.toThrow("MCP request 'tools/call' was aborted")
			expect(performance.now() - began).toBeLessThan(timeout / 4)
			await waitForDelay(timeout / 2)
			const joined = performance.now()
			const next = await client.call('read', { from: 1, search: 'cart' })
			expect(JSON.stringify(next)).toContain('BROWSER_SERVER_CRASH:')
			expect(performance.now() - joined).toBeLessThan(timeout * 0.8)
			expect(
				transport.sent.filter((message) => message.method === 'Browser.getVersion'),
			).toHaveLength(3)
			expect(fixture.launcher.browsers).toHaveLength(2)
		} finally {
			held.resolve()
			await fixture.teardown.destroy()
		}
	})
	it('keeps a stalling sweep off the handshake and aborts its attach at destroy', async () => {
		const fixture = createBrowseFixture()
		const stall = await createStallServer()
		const folder = fixture.scratch.ensure(
			join('browsers', '.profiles', formatBrowserLockEntry(readExitedProcessId(), randomUUID())),
		)
		writeFileSync(
			join(folder, BROWSER_SERVER_RECORD),
			JSON.stringify({
				pid: process.pid,
				endpoint: stall.endpoint.replace('/cdp', '/devtools/browser/stall'),
			}),
		)
		try {
			await fixture.server.start()
			expect(await fixture.pair.initialize()).toHaveProperty('serverInfo')
			await waitForCondition('sweep attached to the stalled peer', () => stall.connections === 1)
			await fixture.server.destroy()
			await waitForCondition('destroy closed the stalled attach', () => stall.connections === 0)
			expect(existsSync(folder)).toBe(true)
		} finally {
			await fixture.teardown.destroy()
			await stall.close()
		}
	})
	it('rechecks a sweep-kept live child after the child exits', async () => {
		const fixture = createBrowseFixture()
		const peer = await createCDPTestServer()
		const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
			stdio: ['pipe', 'ignore', 'ignore'],
		})
		const pid = requireValue(child.pid, 'child pid')
		const folder = fixture.scratch.ensure(
			join('browsers', '.profiles', formatBrowserLockEntry(readExitedProcessId(), randomUUID())),
		)
		writeFileSync(
			join(folder, BROWSER_SERVER_RECORD),
			JSON.stringify({ pid, endpoint: peer.endpoint.replace('/cdp', '/devtools/browser/child') }),
		)
		try {
			await fixture.server.start()
			await waitForCondition('sweep close request', () =>
				peer.received.some((message) => message.method === 'Browser.close'),
			)
			const request = requireValue(
				peer.received.find((message) => message.method === 'Browser.close'),
				'close request',
			)
			peer.fail(request.id, 'refusing close')
			await waitForCondition('sweep released connection', () => peer.sockets === 0)
			expect(existsSync(folder)).toBe(true)
			child.stdin?.end()
			await waitForProcessExit(pid)
			await fixture.server.destroy()
			expect(existsSync(folder)).toBe(false)
		} finally {
			child.kill()
			await waitForProcessExit(pid)
			await fixture.teardown.destroy()
			await peer.close()
		}
	})
	it('reports an unreadable profiles directory when the host enforces mode 0300', async (context) => {
		const fixture = createBrowseFixture()
		const profiles = fixture.scratch.ensure('browsers/.profiles')
		chmodSync(profiles, 0o300)
		try {
			let refusal: string | undefined
			try {
				readdirSync(profiles)
			} catch (error) {
				refusal = readErrorCode(error)
			}
			expect([undefined, 'EACCES']).toContain(refusal)
			const enforced = refusal === 'EACCES'
			if (enforced) mkdirSync(join(profiles, 'mode-probe'))
			context.skip(
				!enforced,
				'The runtime permits readdir on a mode-0300 directory; this host does not enforce the required denial',
			)
			expect(() => readdirSync(profiles)).toThrow(expect.objectContaining({ code: 'EACCES' }))
			await fixture.server.start()
			expect(await fixture.pair.initialize()).toHaveProperty('serverInfo')
			await waitForCondition('sweep failure line', () =>
				fixture.log.lines.some((line) => line.includes('BROWSER_SERVER_SWEEP')),
			)
			expect(
				fixture.log.lines.filter((line) => line.includes('BROWSER_SERVER_SWEEP')),
			).toHaveLength(1)
		} finally {
			chmodSync(profiles, 0o700)
			await fixture.teardown.destroy()
		}
	})
	it('writes one teardown line when a later end listener emits SIGTERM', async () => {
		const failure = new Error('fixture teardown failed')
		const fixture = createBrowseFixture(undefined, { cleanup: failure })
		const exitCode = process.exitCode
		try {
			await fixture.server.start()
			fixture.pair.input.on('end', () => process.emit('SIGTERM'))
			fixture.pair.input.end()
			await waitForCondition('teardown line', () =>
				fixture.log.lines.some((line) => line.includes('BROWSER_SERVER_TEARDOWN')),
			)
			expect(
				fixture.log.lines.filter((line) => line.includes('BROWSER_SERVER_TEARDOWN')),
			).toHaveLength(1)
			expect(process.exitCode).toBe(1)
			await expect(fixture.server.destroy()).rejects.toMatchObject({ errors: [failure] })
		} finally {
			await fixture.teardown.destroy().catch(() => undefined)
			process.exitCode = exitCode
		}
	})

	it('retains a throwing log write for destroy without an unhandled rejection', async () => {
		const failure = new Error('host write threw')
		const log = new Writable({
			write() {
				throw failure
			},
		})
		const unhandled = createRecorder<[unknown]>()
		process.on('unhandledRejection', unhandled.handler)
		const fixture = createBrowseFixture({ log }, { failures: 2 })
		try {
			await expect(fixture.server.start()).rejects.toMatchObject({
				code: 'BROWSER_SERVER_UNAVAILABLE',
			})
			await expect(fixture.server.destroy()).rejects.toMatchObject({ errors: [failure] })
			await waitForDelay()
			expect(unhandled.calls).toEqual([])
		} finally {
			process.off('unhandledRejection', unhandled.handler)
			await fixture.teardown.destroy().catch(() => undefined)
			log.destroy()
		}
	})

	it('retains the callback error from a destroyed log stream without adding listeners', async () => {
		const log = new Writable({
			write(_chunk, _encoding, callback) {
				callback()
			},
		})
		log.destroy()
		const listeners = log.listenerCount('error')
		const unhandled = createRecorder<[unknown]>()
		process.on('unhandledRejection', unhandled.handler)
		const fixture = createBrowseFixture({ log }, { failures: 2 })
		try {
			await expect(fixture.server.start()).rejects.toMatchObject({
				code: 'BROWSER_SERVER_UNAVAILABLE',
			})
			await expect(fixture.server.destroy()).rejects.toMatchObject({
				errors: expect.arrayContaining([expect.objectContaining({ code: 'ERR_STREAM_DESTROYED' })]),
			})
			expect(log.listenerCount('error')).toBe(listeners)
			await waitForDelay()
			expect(unhandled.calls).toEqual([])
		} finally {
			process.off('unhandledRejection', unhandled.handler)
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})
})

describe('BrowserMCPServer', () => {
	it('forwards viewport to every warm, spare, and refill', async () => {
		const viewport = { width: 390, height: 844 }
		const fixture = createBrowseFixture({ viewport, pool: { contexts: 1, size: 2 } })
		try {
			await fixture.server.start()
			await waitForCondition('viewport spare', () => fixture.launcher.browsers.length === 2)
			for (const browser of fixture.launcher.browsers)
				expect(browser.options.viewport).toEqual(viewport)
			requireValue(fixture.launcher.browsers[0], 'lease').drop()
			expect((await fixture.pair.call(2, 'read', { from: 1, search: 'page' })).error).toBe(false)
			await waitForCondition('viewport refill', () => fixture.launcher.browsers.length === 3)
			expect(fixture.launcher.browsers[2]?.options.viewport).toEqual(viewport)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('eager U6 launches before input and lists the vocabulary with its copy', async () => {
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
			expect(launcher.browsers).toHaveLength(1)
			expect(pair.answered).toEqual([])
			expect(launcher.browsers[0]?.options).not.toHaveProperty('viewport')
			expect(await pair.initialize()).toMatchObject({ serverInfo: { name: 'browse' } })
			const listed = await pair.request(2, 'tools/list')
			const tools = listed['tools']
			if (!Array.isArray(tools)) throw new Error('tools/list answered no tool array')
			expect(
				tools.map((tool: unknown) => (isRecord(tool) ? tool['name'] : undefined)),
			).toStrictEqual(BROWSE_VOCABULARY)
			for (const tool of tools) {
				const copy = [
					...Object.values(BROWSER_TOOL_COPY),
					...Object.values(BROWSER_SERVER_COPY),
				].find((row) => isRecord(tool) && row.name === tool['name'])
				if (copy === undefined || !isRecord(tool))
					throw new Error(`tools/list answered an unknown tool: ${JSON.stringify(tool)}`)
				expect(tool['description']).toBe(copy.description)
				expect(tool['inputSchema']).toStrictEqual(copy.parameters)
				expect(tool['annotations']).toStrictEqual(
					copy.annotations === undefined ? undefined : toolAnnotationsToMCP(copy.annotations),
				)
			}
			expect(launcher.browsers).toHaveLength(1)
			expect(existsSync(root)).toBe(true)
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
				expect((await pair.call(2, 'read', { from: 1, search: 'the cart' })).error).toBe(false)
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
			await servers[0]?.destroy()
			expect(existsSync(requireValue(profiles[1], 'second profile'))).toBe(true)
			expect(
				(await requireValue(pairs[1], 'second pair').call(3, 'read', { from: 1, search: 'cart' }))
					.error,
			).toBe(false)
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
				id: 'reading',
				name: 'read',
				arguments: { from: 1, search: 'the cart' },
			})
			if (!expected.success) throw new Error(expected.error)
			const unadvertised = { search: 'the cart', colour: 'red' }
			const refusal = await toolset.tools.execute({
				id: 'reading',
				name: 'read',
				arguments: unadvertised,
			})
			if (refusal.success) throw new Error('read accepted an unadvertised argument')
			await server.start()
			await pair.initialize()
			expect(await pair.call(2, 'read', { from: 1, search: 'the cart' })).toStrictEqual({
				text: expected.value,
				error: false,
			})
			expect(await pair.call(3, 'read', unadvertised)).toStrictEqual({
				text: refusal.error,
				error: true,
			})
			expect(await pair.call(4, 'journeys', { from: 1, search: 'every journey' })).toStrictEqual({
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
			expect((await pair.call(6, 'read', { from: 1 })).error).toBe(false)
			expect(pair.answered).not.toContain(5)
		} finally {
			await teardown.destroy()
		}
	})

	it('answers a click that opens a dialog, then the dialog, through the server', async () => {
		const scratch = createScratch()
		const withheld: CDPSentMessage[] = []
		const launcher = new BrowserLauncher({
			released: (message, transport) => {
				if (withheld.length === 0) withheld.push(message)
				else transport.reply(message.id, {})
			},
		})
		const pair = new MCPStdioPair()
		const server = createBrowserMCPServer({
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
			expect((await pair.call(2, 'read', { from: 1, search: 'the order' })).error).toBe(false)
			const transport = requireValue(
				launcher.browsers[0]?.fixture?.transport,
				'no launch connected',
			)
			replyOk(transport, 'Page.handleJavaScriptDialog')
			pair.send({
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/call',
				params: { name: 'click', arguments: { ref: 'e4' } },
			})
			await waitForCondition('the click release to be withheld', () => withheld.length === 1, {
				budget: 3000,
				interval: 10,
			})
			transport.event(
				'Page.javascriptDialogOpening',
				{ type: 'confirm', message: 'Delete the draft?' },
				'session-main',
			)
			expect(await pair.answer(3)).toStrictEqual({
				content: [
					{
						type: 'text',
						text: 'Clicked e4 button "Place order". A confirm dialog is open: "Delete the draft?"; call dialog.',
					},
				],
			})
			const answered = await pair.call(4, 'dialog', { accept: true })
			expect(answered.error).toBe(false)
			expect(answered.text).toMatch(
				/^Accepted the confirm dialog "Delete the draft\?"\.\n\npage "Cart"/u,
			)
			expect(
				transport.sent.filter((message) => message.method === 'Page.handleJavaScriptDialog'),
			).toHaveLength(1)
			transport.reply(requireValue(withheld[0], 'no release was withheld').id, {})
		} finally {
			await teardown.destroy()
		}
	})

	it('mirrors an adopted page tool, notifies a subscribed client, and removes it on withdrawal', async () => {
		const scratch = createScratch()
		const launcher = new BrowserLauncher({
			registry: (message, transport) => transport.reply(message.id, {}),
		})
		const pair = new MCPStdioPair()
		const server = createBrowserMCPServer({
			root: join(scratch.path, 'tmp/browsers'),
			launch: launcher.launch,
			stdio: pair,
		})
		const client = createMCPClient({
			transport: createDuplexClientTransport(pair.transport),
			identity: { name: 'browse-test', version: '1.0.0' },
		})
		const subscription = new AbortController()
		const teardown = createTeardown()
		teardown.add(() => scratch.destroy())
		teardown.add(() => server.destroy())
		teardown.add(bindClient(client, pair.transport))
		teardown.add(() => subscription.abort())
		try {
			await server.start()
			await client.connect()
			const stream = client.listen({ toolsListChanged: true }, { signal: subscription.signal })
			const acknowledged = await stream.next()
			expect(acknowledged.done === false ? acknowledged.value.method : undefined).toBe(
				'notifications/subscriptions/acknowledged',
			)
			await client.call('read', { from: 1, search: 'the cart' })
			const transport = requireValue(
				launcher.browsers[0]?.fixture?.transport,
				'no launch connected',
			)
			replyOk(transport, 'WebMCP.disable')
			transport.onSend('WebMCP.invokeTool', (message) => {
				transport.reply(message.id, { invocationId: 'search-1' })
				transport.event(
					'WebMCP.toolResponded',
					{ invocationId: 'search-1', status: 'Completed', output: 'Two kettles match.' },
					'session-main',
				)
			})
			const adding = stream.next()
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search the catalog', frameId: 'main' }] },
				'session-main',
			)
			const added = await adding
			expect(added.done === false ? added.value.method : undefined).toBe(
				'notifications/tools/list_changed',
			)
			const listed = await client.tools()
			expect(listed.map((tool) => tool.name)).toStrictEqual([...BROWSE_VOCABULARY, 'search'])
			expect(listed.at(-1)?.description).toBe('Search the catalog')
			const searched = await client.call('search', { query: 'kettle' })
			expect(searched).toMatchObject({ resultType: 'complete' })
			expect(
				transport.sent.find((message) => message.method === 'WebMCP.invokeTool')?.params,
			).toMatchObject({ toolName: 'search', input: { query: 'kettle' } })
			const removing = stream.next()
			transport.event(
				'WebMCP.toolsRemoved',
				{ tools: [{ name: 'search', frameId: 'main' }] },
				'session-main',
			)
			await waitForCondition(
				'the withdrawn page tool to leave tools/list',
				async () => !(await client.tools()).some((tool) => tool.name === 'search'),
				{ budget: 2000, interval: 20 },
			)
			const removed = await removing
			expect(removed.done === false ? removed.value.method : undefined).toBe(
				'notifications/tools/list_changed',
			)
			expect((await client.tools()).map((tool) => tool.name)).toStrictEqual(BROWSE_VOCABULARY)
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
							params: { name: 'read', arguments: { from: 1, search: 'the cart' } },
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

		it('launches nothing for a call that reaches its dispatcher after destroy began', async () => {
			const scratch = createScratch()
			const root = join(scratch.path, 'tmp/browsers')
			const launcher = new BrowserLauncher()
			const pair = new MCPStdioPair()
			const server = createBrowserMCPServer({ root, launch: launcher.launch, stdio: pair })
			const teardown = createTeardown()
			teardown.add(() => scratch.destroy())
			teardown.add(() => server.destroy())
			let admission: BrowserPromiseObserver | undefined
			let dispatcher: BrowserPromiseObserver | undefined
			try {
				await server.start()
				await pair.initialize()
				admission = new BrowserPromiseObserver(
					/at BrowserMCPServer\.#race[^\n]+\n\s+at BrowserMCPServer\.#serve/u,
				)
				let destroying: Promise<void> | undefined
				// Promise initialization precedes the async body, pinning closing before admission.
				dispatcher = new BrowserPromiseObserver(/at BrowserMCPServer\.#forward/u, undefined, () => {
					destroying = server.destroy()
				})
				pair.send({
					jsonrpc: '2.0',
					id: 2,
					method: 'tools/call',
					params: { name: 'read', arguments: { from: 1, search: 'the cart' } },
				})
				await waitForCondition('destroy to begin', () => destroying !== undefined, {
					budget: 3000,
					interval: 10,
				})
				await destroying
				await waitForCondition(
					'rejected dispatcher settled',
					() => dispatcher?.resolved !== undefined,
				)
				expect(admission.created).toBeUndefined()
				expect(launcher.browsers).toHaveLength(1)
				expect(readdirSync(join(root, '.profiles'))).toEqual([])
				expect(pair.answered).not.toContain(2)
			} finally {
				admission?.destroy()
				dispatcher?.destroy()
				await teardown.destroy()
			}
		})

		it('refuses to start again after destroy', async () => {
			const pair = new MCPStdioPair()
			const server = createBrowserMCPServer({ launch: new BrowserLauncher().launch, stdio: pair })
			await server.destroy()
			await expect(server.start()).rejects.toMatchObject({ code: 'BROWSER_TOOLSET_ENDED' })
			expect(pair.input.listenerCount('data')).toBe(0)
		})
	})
})

describe('C1 context ownership', () => {
	it('replaces an idle prepared generation after its page crashes', async () => {
		const fixture = createBrowseFixture({ pool: { size: 2, contexts: 2 } })
		try {
			await fixture.server.start()
			await waitForCondition(
				'spare browser is watched',
				() => fixture.launcher.browsers[1]?.emitter.count('disconnect') === 1,
			)
			const spare = requireValue(fixture.launcher.browsers[1])
			const context = requireValue(spare.context())
			const page = requireValue(context.page())
			page.emitter.emit('crash')
			const acquired = parseJSON(
				(await fixture.pair.call(2, 'acquire', { purpose: 'fresh page' })).text,
			)
			if (!isRecord(acquired)) throw new Error('Missing holder')
			expect(spare.contexts()).toHaveLength(2)
			expect(context.disposal).toEqual({ confirmed: true })
			expect(page.emitter.count('crash')).toBe(0)
			const successor = requireValue(spare.context(1)?.page())
			expect(successor.closed).toBe(false)
			expect(successor.emitter.count('crash')).toBe(1)
			expect(
				(
					await fixture.pair.call(3, 'execute', {
						holder: acquired['holder'],
						name: 'read',
						arguments: { from: 1, search: 'cart' },
					})
				).error,
			).toBe(false)
			expect(spare.destroyed).toBe(false)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('keeps a FIFO recovery waiter off a co-held browser retiring after refused disposal', async () => {
		const fixture = createBrowseFixture({ pool: { size: 2, contexts: 2 } })
		let waiting: BrowserPromiseObserver | undefined
		try {
			await fixture.server.start()
			await waitForCondition(
				'both browser records are live',
				() => fixture.launcher.browsers[1]?.emitter.count('disconnect') === 1,
			)
			const first = parseJSON((await fixture.pair.call(2, 'acquire', { purpose: 'B first' })).text)
			await fixture.pair.call(3, 'acquire', { purpose: 'A second' })
			await fixture.pair.call(4, 'acquire', { purpose: 'B second' })
			if (!isRecord(first)) throw new Error('Missing holder')
			const a = requireValue(fixture.launcher.browsers[0])
			const b = requireValue(fixture.launcher.browsers[1])
			fixture.launcher.hold()
			a.kill()
			await waitForCondition(
				'A refill starts behind barrier',
				() => fixture.launcher.browsers.length === 3,
			)
			const entered = Promise.withResolvers<void>()
			waiting = new BrowserPromiseObserver(/at Pool\.acquire/, undefined, entered.resolve)
			const recovery = fixture.pair.call(5, 'read', { from: 1, search: 'cart' })
			await entered.promise
			b.script('Target.disposeBrowserContext', (message, transport) =>
				transport.fail(message.id, 'disposal refused'),
			)
			expect((await fixture.pair.call(6, 'destroy', { holder: first['holder'] })).error).toBe(false)
			expect(fixture.pair.answered).not.toContain(5)
			fixture.launcher.release()
			expect((await recovery).error).toBe(false)
			expect(b.destroys).toBe(1)
		} finally {
			waiting?.destroy()
			fixture.launcher.release()
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})

	it('keeps the browser and co-holder attached after a downloads mkdir failure', async () => {
		const fixture = createBrowseFixture()
		try {
			await fixture.server.start()
			const browser = requireValue(fixture.launcher.browsers[0])
			const sibling = requireValue(browser.context()?.page())
			const directory = join(requireValue(browser.options.profile), 'contexts')
			const moved = directory + '-held'
			await rename(directory, moved)
			writeFileSync(directory, 'refuse child directory creation')
			try {
				expect((await fixture.pair.call(2, 'acquire', { purpose: 'mkdir failure' })).error).toBe(
					true,
				)
				expect(browser.destroyed).toBe(false)
				expect(sibling.closed).toBe(false)
				expect(
					(await fixture.pair.call(3, 'read', { from: 1, search: 'cart' })).text,
				).not.toContain('BROWSER_SERVER_CRASH')
			} finally {
				await rm(directory, { force: true })
				if (existsSync(moved)) await rename(moved, directory)
			}
			expect((await fixture.pair.call(4, 'acquire', { purpose: 'capacity released' })).error).toBe(
				false,
			)
			expect(fixture.launcher.browsers).toHaveLength(1)
		} finally {
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})

	it('accepts both pool.contexts bounds without launching', async () => {
		for (const contexts of [1, 4]) {
			const fixture = createBrowseFixture({ pool: { contexts } })
			try {
				expect(fixture.launcher.browsers).toEqual([])
			} finally {
				await fixture.teardown.destroy()
			}
		}
	})

	it('keeps a successor attached when an interrupted old generation completes', async () => {
		const entered = Promise.withResolvers<CDPSentMessage>()
		const pending = Promise.withResolvers<CDPSentMessage>()
		const fixture = createBrowseFixture(
			{ pool: { size: 2, contexts: 2 } },
			{
				evaluation: (message, transport) => {
					if (message.params?.['awaitPromise'] === true) entered.resolve(message)
					else transport.reply(message.id, { result: { value: true } })
				},
			},
		)
		try {
			await fixture.server.start()
			await waitForCondition(
				'spare browser is ready',
				() => fixture.launcher.browsers[1]?.emitter.count('disconnect') === 1,
			)
			const acquired = parseJSON(
				(await fixture.pair.call(2, 'acquire', { purpose: 'old generation' })).text,
			)
			if (!isRecord(acquired)) throw new Error('Missing holder')
			const other = parseJSON(
				(await fixture.pair.call(6, 'acquire', { purpose: 'temporary A holder' })).text,
			)
			await fixture.pair.call(7, 'acquire', { purpose: 'B co-holder' })
			if (!isRecord(other)) throw new Error('Missing temporary holder')
			await fixture.pair.call(8, 'destroy', { holder: other['holder'] })
			const browser = requireValue(fixture.launcher.browsers[1])
			const transport = requireValue(browser.fixture?.transport)
			const old = requireValue(browser.context(0)?.page())
			const call = fixture.pair.call(3, 'execute', {
				holder: acquired['holder'],
				name: 'wait',
				arguments: { text: 'not present' },
			})
			const evaluation = await entered.promise
			browser.script('Browser.getVersion', pending.resolve)
			transport.fail(evaluation.id, 'old generation failed')
			const ping = await pending.promise
			old.emitter.emit('crash')
			const catalog = await fixture.pair.call(4, 'tools', { holder: acquired['holder'] })
			expect(catalog.error).toBe(false)
			expect(fixture.pair.answered).not.toContain(3)
			const successor = requireValue(fixture.launcher.browsers[0]?.context(2)?.page())
			expect(successor.closed).toBe(false)
			transport.reply(ping.id, {})
			expect((await call).text).toContain('BROWSER_SERVER_UNRESOLVED')
			const result = await fixture.pair.call(5, 'tools', { holder: acquired['holder'] })
			expect(result.error).toBe(false)
			expect(result.text).not.toContain('BROWSER_SERVER_CRASH')
			expect(parseJSON(result.text)).toEqual(acquired)
			expect(successor.closed).toBe(false)
			expect(fixture.launcher.browsers[0]?.contexts()).toHaveLength(3)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('keeps admission occupied until uncertain browser retirement settles', async () => {
		const fixture = createBrowseFixture()
		const pending = Promise.withResolvers<CDPSentMessage>()
		let transport: CDPTestTransportInterface | undefined
		let request: CDPSentMessage | undefined
		try {
			await fixture.server.start()
			const acquired = parseJSON(
				(await fixture.pair.call(2, 'acquire', { purpose: 'retiring host' })).text,
			)
			if (!isRecord(acquired)) throw new Error('Missing holder')
			const browser = requireValue(fixture.launcher.browsers[0])
			transport = requireValue(browser.fixture?.transport)
			browser.script('Target.disposeBrowserContext', (message, peer) => {
				if (message.params?.['browserContextId'] === 'context-2')
					peer.fail(message.id, 'uncertain disposal')
				else pending.resolve(message)
			})
			const ending = fixture.pair.call(3, 'destroy', { holder: acquired['holder'] })
			request = await pending.promise
			expect(
				(await fixture.pair.call(4, 'acquire', { purpose: 'retirement pending' })).text,
			).toContain('BROWSER_SERVER_BUSY')
			expect(fixture.pair.answered).not.toContain(3)
			transport.reply(request.id, {})
			expect(await ending).toEqual({ error: false, text: 'Holder destroyed.' })
			expect(browser.destroys).toBe(1)
		} finally {
			if (request !== undefined) transport?.reply(request.id, {})
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})
	it('reports a construction disposal protocol failure on a healthy connected browser', async () => {
		const peer = await createCDPTestServer()
		const browser = createBrowser({ cdp: { endpoint: peer.endpoint, discover: false } })
		peer.script('Target.createBrowserContext', { browserContextId: 'constructing' })
		const fixture = createBrowseFixture({ launch: () => browser })
		const starting = fixture.server.start().catch((error: unknown) => error)
		try {
			await waitForCondition('construction reached target creation', () =>
				peer.received.some((message) => message.method === 'Target.createTarget'),
			)
			const context = requireValue(browser.contexts().find((entry) => entry.id === 'constructing'))
			peer.fail(
				requireValue(peer.received.find((message) => message.method === 'Target.createTarget')).id,
				'construction refused',
			)
			await waitForCondition('failed construction reached disposal', () =>
				peer.received.some((message) => message.method === 'Target.disposeBrowserContext'),
			)
			expect(browser.status).toBe('connected')
			peer.fail(
				requireValue(
					peer.received.find((message) => message.method === 'Target.disposeBrowserContext'),
				).id,
				'healthy disposal refused',
			)
			expect(await starting).toBeInstanceOf(Error)
			const outcome = requireValue(context.disposal)
			if (outcome.confirmed) throw new Error('Expected disposal refusal')
			expect(outcome.error).toBeInstanceOf(CDPError)
			await expect(fixture.server.destroy()).rejects.toMatchObject({
				message: 'The browse server teardown failed',
				errors: expect.arrayContaining([outcome.error]),
			})
		} finally {
			await peer.close()
			await starting
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})

	it('suppresses a construction disposal protocol failure after the connected browser is lost', async () => {
		const peer = await createCDPTestServer()
		const browser = createBrowser({ cdp: { endpoint: peer.endpoint, discover: false } })
		for (const method of [
			'Browser.getVersion',
			'Page.enable',
			'Runtime.enable',
			'WebMCP.enable',
			'WebMCP.disable',
			'Target.detachFromTarget',
			'Target.closeTarget',
		])
			peer.script(method, {})
		peer.script('Target.createBrowserContext', { browserContextId: 'shared' })
		peer.script('Target.createTarget', { targetId: 'page' })
		peer.script('Target.attachToTarget', { sessionId: 'session' })
		const fixture = createBrowseFixture({ launch: () => browser })
		try {
			await fixture.server.start()
			peer.script('Target.createBrowserContext', { browserContextId: 'constructing' })
			// The malformed creation reply loses the slot while its transport remains connected.
			peer.script('Target.createTarget', {})
			const acquiring = fixture.pair.call(2, 'acquire', { purpose: 'failed construction' })
			await waitForCondition('lost construction reached disposal', () =>
				peer.received.some(
					(message) =>
						message.method === 'Target.disposeBrowserContext' &&
						message.params?.['browserContextId'] === 'constructing',
				),
			)
			const context = requireValue(browser.contexts().find((entry) => entry.id === 'constructing'))
			expect(browser.status).toBe('connected')
			const disposal = requireValue(
				peer.received.find(
					(message) =>
						message.method === 'Target.disposeBrowserContext' &&
						message.params?.['browserContextId'] === 'constructing',
				),
			)
			peer.script('Target.disposeBrowserContext', {})
			peer.fail(disposal.id, 'lost disposal refused')
			expect((await acquiring).error).toBe(true)
			const outcome = requireValue(context.disposal)
			if (outcome.confirmed) throw new Error('Expected disposal refusal')
			expect(outcome.error).toBeInstanceOf(CDPError)
			await expect(fixture.server.destroy()).resolves.toBeUndefined()
		} finally {
			await peer.close()
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})

	it('does not report remote disposal after a constructing browser disconnects before shutdown', async () => {
		const peer = await createCDPTestServer()
		const browser = createBrowser({ cdp: { endpoint: peer.endpoint, discover: false } })
		await browser.connect()
		// Loss also releases earlier contexts; construction cleanup can run before that drain ends.
		peer.script('Target.createBrowserContext', { browserContextId: 'earlier' })
		await browser.isolate()
		peer.script('Target.createBrowserContext', { browserContextId: 'constructing' })
		const fixture = createBrowseFixture({
			launch: () => browser,
		})
		const starting = fixture.server.start().catch((error: unknown) => error)
		try {
			await waitForCondition('context construction reached the remote page request', () =>
				peer.received.some((message) => message.method === 'Target.createTarget'),
			)
			await peer.close()
			expect(await starting).toBeInstanceOf(Error)
			await expect(fixture.server.destroy()).resolves.toBeUndefined()
			expect(readdirSync(join(fixture.root, '.profiles'))).toEqual([])
		} finally {
			await peer.close()
			await starting
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})

	it('does not report remote disposal during a launched browser transport-loss defer', async () => {
		const peer = await createCDPTestServer()
		const scratch = createScratch()
		const entry = scratch.write(
			'peer.ts',
			"import { createServer } from 'node:http'\n" +
				"createServer().listen(0, '127.0.0.1')\n" +
				"process.stderr.write('DevTools listening on ' + process.argv[2] + '\\n')\n",
		)
		peer.script('Target.createBrowserContext', { browserContextId: 'constructing' })
		const fixture = createBrowseFixture({
			launch: (options) =>
				createBrowser({ ...options, executable: process.execPath, args: [entry, peer.endpoint] }),
		})
		const starting = fixture.server.start().catch((error: unknown) => error)
		try {
			await waitForCondition('launched context construction reached the remote page request', () =>
				peer.received.some((message) => message.method === 'Target.createTarget'),
			)
			await peer.close()
			expect(await starting).toBeInstanceOf(Error)
			await expect(fixture.server.destroy()).resolves.toBeUndefined()
			expect(readdirSync(join(fixture.root, '.profiles'))).toEqual([])
		} finally {
			await peer.close()
			await starting
			await fixture.teardown.destroy().catch(() => undefined)
			scratch.destroy()
		}
	})

	it('does not report remote disposal after shutdown disconnects a constructing browser', async () => {
		const peer = await createCDPTestServer()
		peer.script('Target.createBrowserContext', { browserContextId: 'constructing' })
		const fixture = createBrowseFixture({
			launch: (options) => createBrowser({ ...options, cdp: { endpoint: peer.endpoint } }),
		})
		const starting = fixture.server.start().catch((error: unknown) => error)
		try {
			await waitForCondition('context construction reached the remote page request', () =>
				peer.received.some((message) => message.method === 'Target.createTarget'),
			)
			const creation = requireValue(
				peer.received.find((message) => message.method === 'Target.createTarget'),
			)
			peer.fail(creation.id, 'construction refused')
			await waitForCondition('failed construction reached context disposal', () =>
				peer.received.some((message) => message.method === 'Target.disposeBrowserContext'),
			)
			const ending = fixture.server.destroy()
			await expect(Promise.all([ending, peer.close()])).resolves.toEqual([undefined, undefined])
			await starting
			expect(readdirSync(join(fixture.root, '.profiles'))).toEqual([])
		} finally {
			await peer.close()
			await starting
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})

	it('consumes prepared contexts without leasing the idle warm browser', async () => {
		const fixture = createBrowseFixture({ pool: { size: 2, contexts: 2 } })
		try {
			await fixture.server.start()
			await waitForCondition(
				'the second browser prepared its page',
				() => fixture.launcher.browsers[1]?.context()?.pages().length === 1,
			)
			const spare = requireValue(fixture.launcher.browsers[1])
			const prepared = spare.context()
			expect(prepared?.page()?.emitter.count('crash')).toBe(1)
			const acquired = await fixture.pair.call(2, 'acquire', { purpose: 'prepared page' })
			expect(acquired.error).toBe(false)
			expect(prepared?.page()?.emitter.count('crash')).toBe(1)
			expect(spare.contexts()).toEqual([prepared])
			expect(fixture.launcher.browsers[0]?.contexts()).toHaveLength(1)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('spends idle refill strikes without holderless grants', async () => {
		const fixture = createBrowseFixture({ pool: { size: 2 } })
		try {
			await fixture.server.start()
			await waitForCondition(
				'idle warm page',
				() => fixture.launcher.browsers[1]?.context()?.pages().length === 1,
			)
			requireValue(fixture.launcher.browsers[1]).kill()
			await waitForCondition(
				'idle refill page',
				() => fixture.launcher.browsers[2]?.context()?.pages().length === 1,
			)
			requireValue(fixture.launcher.browsers[2]).kill()
			await waitForCondition(
				'idle budget spent',
				() => fixture.launcher.browsers[2]?.destroyed === true,
			)
			expect((await fixture.pair.call(2, 'read', { from: 1, search: 'cart' })).error).toBe(false)
			expect(fixture.launcher.browsers).toHaveLength(3)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('preserves handles and catalogs and admits one named holder at the default', async () => {
		const fixture = createBrowseFixture()
		try {
			await fixture.server.start()
			const result = await fixture.pair.call(2, 'acquire', { purpose: 'default named context' })
			const acquired = parseJSON(result.text)
			if (!isRecord(acquired)) throw new Error(result.text)
			expect(Object.keys(acquired)).toEqual(['holder', 'tools'])
			expect(acquired['holder']).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/u))
			expect(
				parseJSON((await fixture.pair.call(3, 'tools', { holder: acquired['holder'] })).text),
			).toEqual(acquired)
			const refused = await fixture.pair.call(4, 'acquire', { purpose: 'past default capacity' })
			expect(refused.error).toBe(true)
			expect(refused.text).toContain('BROWSER_SERVER_BUSY: shared (Shared browser),')
			expect(refused.text).toContain(`${String(acquired['holder'])} (default named context)`)
			expect(fixture.launcher.browsers).toHaveLength(1)
			expect(fixture.launcher.browsers[0]?.contexts()).toHaveLength(2)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('reproduces exclusive admission with contexts one', async () => {
		const fixture = createBrowseFixture({ pool: { size: 3, contexts: 1 } })
		try {
			await fixture.server.start()
			expect((await fixture.pair.call(2, 'acquire', { purpose: 'first' })).error).toBe(false)
			expect((await fixture.pair.call(3, 'acquire', { purpose: 'second' })).error).toBe(false)
			expect((await fixture.pair.call(4, 'acquire', { purpose: 'over bound' })).text).toContain(
				'BROWSER_SERVER_BUSY',
			)
			expect(fixture.launcher.browsers.map((browser) => browser.contexts().length)).toEqual([
				1, 1, 1,
			])
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('reserves least occupancy before awaiting bounded constructions', async () => {
		const fixture = createBrowseFixture({ pool: { size: 2, contexts: 2 } })
		const pending: Array<{
			readonly request: CDPSentMessage
			readonly transport: CDPTestTransportInterface
		}> = []
		try {
			await fixture.server.start()
			await waitForCondition(
				'both browser records are live',
				() => fixture.launcher.browsers[1]?.emitter.count('disconnect') === 1,
			)
			expect(
				(await fixture.pair.call(2, 'acquire', { purpose: 'second prepared context' })).error,
			).toBe(false)
			for (const browser of fixture.launcher.browsers) {
				browser.script('Target.createBrowserContext', (request, transport) => {
					pending.push({ request, transport })
				})
			}
			const first = fixture.pair.call(3, 'acquire', { purpose: 'construction first' })
			await waitForCondition('first reserved construction', () => pending.length === 1)
			const second = fixture.pair.call(4, 'acquire', { purpose: 'construction second' })
			await waitForCondition('second reserved construction', () => pending.length === 2)
			expect(new Set(pending.map((entry) => entry.transport)).size).toBe(2)
			expect((await fixture.pair.call(5, 'acquire', { purpose: 'over bound' })).text).toContain(
				'BROWSER_SERVER_BUSY',
			)
			for (const entry of pending)
				entry.transport.reply(entry.request.id, { browserContextId: 'reserved-context' })
			expect((await first).error).toBe(false)
			expect((await second).error).toBe(false)
			expect(fixture.launcher.browsers.map((browser) => browser.contexts().length)).toEqual([2, 2])
		} finally {
			for (const entry of pending)
				entry.transport.reply(entry.request.id, { browserContextId: 'late-context' })
			await fixture.teardown.destroy()
		}
	})

	it('recovers one renderer in a single flight while its sibling stays attached', async () => {
		const fixture = createBrowseFixture()
		try {
			await fixture.server.start()
			const acquired = parseJSON(
				(await fixture.pair.call(2, 'acquire', { purpose: 'renderer' })).text,
			)
			if (!isRecord(acquired)) throw new Error('Missing holder')
			const browser = requireValue(fixture.launcher.browsers[0])
			const sibling = requireValue(browser.context(0)?.page())
			const context = requireValue(browser.context(1))
			const page = requireValue(context.page())
			page.emitter.emit('crash')
			const results = await Promise.all(
				[3, 4, 5].map((id) => fixture.pair.call(id, 'tools', { holder: acquired['holder'] })),
			)
			for (const result of results) expect(result.error).toBe(false)
			expect(results.filter((result) => result.text.includes('BROWSER_SERVER_CRASH'))).toHaveLength(
				1,
			)
			expect(browser.contexts()).toHaveLength(3)
			expect(context.disposal?.confirmed).toBe(true)
			expect(sibling.closed).toBe(false)
			expect(browser.destroyed).toBe(false)
			expect(
				(await fixture.pair.call(6, 'read', { from: 1, search: 'sibling' })).text,
			).not.toContain('BROWSER_SERVER_CRASH')
			page.emitter.emit('crash')
			expect(
				(await fixture.pair.call(7, 'tools', { holder: acquired['holder'] })).text,
			).not.toContain('BROWSER_SERVER_CRASH')
			expect(browser.contexts()).toHaveLength(3)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it('invalidates a browser once with each generation own URL and leaves the other browser untouched', async () => {
		const fixture = createBrowseFixture({ pool: { size: 2, contexts: 2 } })
		try {
			await fixture.server.start()
			await waitForCondition(
				'both browser records are live',
				() => fixture.launcher.browsers[1]?.emitter.count('disconnect') === 1,
			)
			const other = parseJSON(
				(await fixture.pair.call(2, 'acquire', { purpose: 'other browser' })).text,
			)
			const sibling = parseJSON(
				(await fixture.pair.call(3, 'acquire', { purpose: 'same browser' })).text,
			)
			if (!isRecord(other) || !isRecord(sibling)) throw new Error('Missing holders')
			const browser = requireValue(fixture.launcher.browsers[0])
			const transport = requireValue(browser.fixture?.transport)
			for (const [index, url] of ['https://shared.test/', 'https://named.test/'].entries()) {
				const page = requireValue(browser.context(index)?.page())
				transport.event(
					'Page.frameNavigated',
					{ frame: { id: 'main', url, loaderId: `loader-${index}` } },
					`session-${page.target}`,
				)
				expect(page.url).toBe(url)
			}
			fixture.launcher.hold()
			browser.kill()
			browser.kill()
			expect((await fixture.pair.call(4, 'tools', { holder: other['holder'] })).text).not.toContain(
				'BROWSER_SERVER_CRASH',
			)
			await waitForCondition('one refill starts', () => fixture.launcher.browsers.length === 3)
			fixture.launcher.release()
			const shared = await fixture.pair.call(5, 'read', { from: 1, search: 'blank' })
			const named = await fixture.pair.call(6, 'tools', { holder: sibling['holder'] })
			expect(shared.error).toBe(false)
			expect(named.error).toBe(false)
			expect(shared.text).toContain('https://shared.test/')
			expect(shared.text).not.toContain('https://named.test/')
			expect(named.text).toContain('https://named.test/')
			expect(named.text).not.toContain('https://shared.test/')
			expect(fixture.launcher.browsers).toHaveLength(3)
			expect(browser.destroys).toBe(1)
		} finally {
			fixture.launcher.release()
			await fixture.teardown.destroy()
		}
	})

	for (const coholder of [false, true]) {
		it(`retires unconfirmed disposal through the ${coholder ? 'leased credit' : 'idle strike'} path`, async () => {
			const fixture = createBrowseFixture({
				pool: { size: coholder ? 1 : 2, contexts: coholder ? 2 : 1 },
			})
			try {
				await fixture.server.start()
				const acquired = parseJSON(
					(await fixture.pair.call(2, 'acquire', { purpose: 'uncertain disposal' })).text,
				)
				if (!isRecord(acquired)) throw new Error('Missing holder')
				const browser = requireValue(fixture.launcher.browsers[coholder ? 0 : 1])
				browser.script('Target.disposeBrowserContext', (message, transport) =>
					transport.fail(message.id, 'disposal refused'),
				)
				const initial = fixture.launcher.browsers.length
				fixture.launcher.refuse(initial)
				expect(await fixture.pair.call(3, 'destroy', { holder: acquired['holder'] })).toEqual({
					error: false,
					text: 'Holder destroyed.',
				})
				await waitForCondition(
					'retirement refill budget spent',
					() =>
						fixture.launcher.browsers.length === initial + (coholder ? 2 : 1) &&
						fixture.launcher.browsers.at(-1)?.destroyed === true,
				)
				expect(browser.destroys).toBe(1)
				expect(fixture.launcher.browsers).toHaveLength(initial + (coholder ? 2 : 1))
				await expect(fixture.server.destroy()).rejects.toThrow('teardown failed')
			} finally {
				await fixture.teardown.destroy().catch(() => undefined)
			}
		})

		it(`retires failed context creation through the ${coholder ? 'leased credit' : 'idle strike'} path`, async () => {
			const fixture = createBrowseFixture({
				pool: { size: coholder ? 1 : 2, contexts: coholder ? 2 : 1 },
			})
			try {
				await fixture.server.start()
				if (!coholder) {
					const acquired = parseJSON(
						(await fixture.pair.call(2, 'acquire', { purpose: 'consume prepared context' })).text,
					)
					if (!isRecord(acquired)) throw new Error('Missing holder')
					await fixture.pair.call(3, 'destroy', { holder: acquired['holder'] })
				}
				const browser = requireValue(fixture.launcher.browsers[coholder ? 0 : 1])
				browser.script('Target.createBrowserContext', (message, transport) =>
					transport.fail(message.id, 'creation refused'),
				)
				const initial = fixture.launcher.browsers.length
				fixture.launcher.refuse(initial)
				expect(await fixture.pair.call(4, 'acquire', { purpose: 'creation failure' })).toEqual({
					error: true,
					text: 'creation refused.',
				})
				await waitForCondition(
					'creation retirement budget spent',
					() =>
						fixture.launcher.browsers.length === initial + (coholder ? 2 : 1) &&
						fixture.launcher.browsers.at(-1)?.destroyed === true,
				)
				expect(browser.destroys).toBe(1)
				expect(fixture.launcher.browsers).toHaveLength(initial + (coholder ? 2 : 1))
			} finally {
				await fixture.teardown.destroy()
			}
		})
	}

	it('keeps failed download removal ownership and admission until teardown reports it', async () => {
		const fixture = createBrowseFixture()
		try {
			await fixture.server.start()
			const acquired = parseJSON(
				(await fixture.pair.call(2, 'acquire', { purpose: 'retained downloads' })).text,
			)
			if (!isRecord(acquired)) throw new Error('Missing holder')
			const browser = requireValue(fixture.launcher.browsers[0])
			const download = browser.fixture?.transport.sent
				.filter((message) => message.method === 'Browser.setDownloadBehavior')
				.at(-1)?.params?.['downloadPath']
			if (!isString(download)) throw new Error('Missing downloads directory')
			const script = fixture.scratch.write(
				'hold.ts',
				'process.stdout.write("ready"); process.stdin.resume()',
			)
			const child = spawn(process.execPath, [script], {
				cwd: download,
				stdio: ['pipe', 'pipe', 'ignore'],
				windowsHide: true,
			})
			const pid = requireValue(child.pid)
			try {
				await waitForEvent<[Buffer]>((listener) => {
					child.stdout.once('data', listener)
					return () => child.stdout.off('data', listener)
				}, 'child owns the downloads directory')
				expect((await fixture.pair.call(3, 'destroy', { holder: acquired['holder'] })).error).toBe(
					false,
				)
				fixture.pair.send({
					jsonrpc: '2.0',
					id: 4,
					method: 'tools/call',
					params: { name: 'acquire', arguments: { purpose: 'must remain full' } },
				})
				await waitForCondition('retained capacity refuses admission', () =>
					fixture.pair.answered.includes(4),
				)
				expect(JSON.stringify(await fixture.pair.answer(4))).toContain('BROWSER_SERVER_BUSY')
				expect(browser.destroyed).toBe(false)
				expect(existsSync(download)).toBe(true)
			} finally {
				child.stdin.end()
				await waitForProcessExit(pid)
			}
			await expect(fixture.server.destroy()).rejects.toThrow('teardown failed')
		} finally {
			await fixture.teardown.destroy().catch(() => undefined)
		}
	})

	it('refuses publication and disposes a context constructed during server teardown', async () => {
		const fixture = createBrowseFixture()
		const entered = Promise.withResolvers<CDPSentMessage>()
		const pages = createRecorder<[BrowserPageInterface]>()
		const crashes = createRecorder<[number]>()
		try {
			await fixture.server.start()
			const browser = requireValue(fixture.launcher.browsers[0])
			const transport = requireValue(browser.fixture?.transport)
			browser.script('Target.createBrowserContext', entered.resolve)
			fixture.pair.send({
				jsonrpc: '2.0',
				id: 2,
				method: 'tools/call',
				params: { name: 'acquire', arguments: { purpose: 'late construction' } },
			})
			const request = await entered.promise
			transport.onSend('Target.createTarget', () => {
				const context = browser.context(1)
				if (context !== undefined && context.emitter.count('page') === 0)
					context.emitter.on('page', (page) => {
						pages.handler(page)
						page.emitter.on('close', () => crashes.handler(page.emitter.count('crash')))
					})
			})
			const ending = fixture.server.destroy()
			transport.reply(request.id, { browserContextId: 'late-context' })
			await ending
			const late = requireValue(pages.calls[0]?.[0])
			expect(late.emitter.count('crash')).toBe(0)
			expect(crashes.calls).toEqual([[0]])
			expect(
				transport.sent
					.filter((message) => message.method === 'Target.disposeBrowserContext')
					.map((message) => message.params?.['browserContextId']),
			).toContain('late-context')
			expect(browser.destroys).toBe(1)
			expect(readdirSync(join(fixture.root, '.profiles'))).toEqual([])
			expect(fixture.pair.answered).not.toContain(2)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	it.each([0, 5, -1, 1.5, NaN, Infinity])('refuses pool.contexts %s before launch', (contexts) => {
		expect(() => createBrowserMCPServer({ pool: { contexts } })).toThrow(
			'pool.contexts must be an integer from 1 through 4',
		)
	})
})
