import type { BrowserInvocation, BrowserInvocationResult } from '@src/core'
import { describe, expect, it } from 'vitest'
import { createRecorder, requireValue, waitForCondition, waitForDelay } from '@orkestrel/test'
import { createAttachedPage, replyOk } from '../../setup.js'

describe('BrowserRegistry', () => {
	it('emits observed invocations and preserves tools on same-document navigation', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			replyOk(transport, 'WebMCP.enable')
			const registry = page.registry
			await Promise.all([registry.start(), registry.start()])
			expect(transport.sent.filter((message) => message.method === 'WebMCP.enable')).toHaveLength(1)
			const invocations = createRecorder<readonly [BrowserInvocation]>()
			registry.emitter.on('invoke', invocations.handler)
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: page.id }] },
				'session-1',
			)
			transport.event(
				'WebMCP.toolInvoked',
				{ invocationId: 'observed', toolName: 'search', frameId: page.id, input: '{}' },
				'session-1',
			)
			expect(invocations.calls).toEqual([
				[{ id: 'observed', tool: 'search', frame: page.id, input: '{}' }],
			])
			transport.event(
				'Page.navigatedWithinDocument',
				{ frameId: page.id, url: 'https://example.com/#section' },
				'session-1',
			)
			expect(registry.tools()).toHaveLength(1)
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: page.id, url: 'https://example.com/next' } },
				'session-1',
			)
			expect(registry.tools()).toEqual([])
		} finally {
			await client.close()
		}
	})

	it('correlates concurrent replies by session and id and ignores unrelated terminal events', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			replyOk(transport, 'WebMCP.enable')
			const registry = page.registry
			await registry.start()
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: page.id }] },
				'session-1',
			)
			const tool = requireValue(registry.tool('search'))
			const first = registry.execute(tool, { query: 'first' })
			const second = registry.execute(tool, { query: 'second' })
			const requests = transport.sent.filter((message) => message.method === 'WebMCP.invokeTool')
			transport.reply(requireValue(requests[1]).id, { invocationId: 'second' })
			transport.event(
				'WebMCP.toolResponded',
				{ invocationId: 'first', status: 'Completed', output: 'wrong session' },
				'foreign-session',
			)
			transport.event(
				'WebMCP.toolResponded',
				{ invocationId: 'second', status: 'Completed', output: 'second result' },
				'session-1',
			)
			transport.reply(requireValue(requests[0]).id, { invocationId: 'first' })
			transport.event(
				'WebMCP.toolResponded',
				{ invocationId: 'first', status: 'Completed', output: 'first result' },
				'session-1',
			)
			expect((await first).output).toBe('first result')
			expect((await second).output).toBe('second result')
		} finally {
			await client.close()
		}
	})

	it('adopts a required authored what and propagates its execution signal', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			replyOk(transport, 'WebMCP.enable')
			replyOk(transport, 'WebMCP.cancelInvocation')
			replyOk(transport, 'WebMCP.invokeTool', { invocationId: 'adopted' })
			const registry = page.registry
			await registry.start()
			transport.event(
				'WebMCP.toolsAdded',
				{
					tools: [
						{
							name: 'search',
							description: 'Search',
							frameId: page.id,
							inputSchema: {
								type: 'object',
								properties: { what: { type: 'string' } },
								required: ['what'],
							},
						},
					],
				},
				'session-1',
			)
			const tool = requireValue((await registry.adopt())[0])
			const controller = new AbortController()
			const result = Promise.resolve(
				tool.execute({ what: 'authored' }, { signal: controller.signal }),
			).catch((error: unknown) => error)
			await waitForDelay()
			controller.abort('adopted abort')
			expect(await result).toBe('adopted abort')
			expect(
				transport.sent.find((message) => message.method === 'WebMCP.invokeTool')?.params?.['input'],
			).toEqual({ what: 'authored' })
			expect(
				transport.sent.find((message) => message.method === 'WebMCP.cancelInvocation')?.params,
			).toEqual({ invocationId: 'adopted' })
		} finally {
			await client.close()
		}
	})

	it('disables an enable reply that arrives after destruction started', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			replyOk(transport, 'WebMCP.disable')
			const registry = page.registry
			const starting = registry.start().catch((error: unknown) => error)
			const request = requireValue(
				transport.sent.find((message) => message.method === 'WebMCP.enable'),
			)
			const destroyed = registry.destroy()
			transport.reply(request.id, {})
			expect(await starting).toMatchObject({ message: expect.stringContaining('destroyed') })
			await destroyed
			expect(transport.sent.filter((message) => message.method === 'WebMCP.disable')).toHaveLength(
				1,
			)
			expect(registry.emitter.destroyed).toBe(true)
		} finally {
			await client.close()
		}
	})

	it('C3 prefers the earlier registration across child frames', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			replyOk(transport, 'WebMCP.enable')
			const registry = page.registry
			await registry.start()
			transport.event(
				'WebMCP.toolsAdded',
				{
					tools: [
						{ name: 'other', description: 'Other', frameId: 'child-a' },
						{ name: 'search', description: 'Earlier', frameId: 'child-b' },
						{ name: 'search', description: 'Later', frameId: 'child-a' },
					],
				},
				'session-1',
			)
			expect(registry.tool('search')?.description).toBe('Earlier')
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Replaced', frameId: 'child-b' }] },
				'session-1',
			)
			expect(registry.tool('search')?.description).toBe('Replaced')
			expect(registry.tools()).toHaveLength(3)
		} finally {
			await client.close()
		}
	})

	it('C1 removes subscriptions on absence and rethrows other enable failures', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			const registry = requireValue(page.registry)
			let code = -32601
			transport.onSend('WebMCP.enable', (message) =>
				transport.fail(message.id, 'unavailable', code),
			)
			const changes = createRecorder<readonly []>()
			const invocations = createRecorder<readonly [BrowserInvocation]>()
			const responses = createRecorder<readonly [BrowserInvocationResult]>()
			registry.emitter.on('change', changes.handler)
			registry.emitter.on('invoke', invocations.handler)
			registry.emitter.on('respond', responses.handler)
			expect(await registry.start()).toBe(false)
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: page.id }] },
				'session-1',
			)
			expect(registry.tools()).toEqual([])
			expect(changes.count).toBe(0)
			transport.event('WebMCP.toolsRemoved', { tools: [] }, 'session-1')
			transport.event(
				'WebMCP.toolInvoked',
				{ invocationId: 'ignored', toolName: 'search', frameId: page.id, input: '{}' },
				'session-1',
			)
			transport.event(
				'WebMCP.toolResponded',
				{ invocationId: 'ignored', status: 'Completed' },
				'session-1',
			)
			expect(changes.count).toBe(0)
			expect(invocations.count).toBe(0)
			expect(responses.count).toBe(0)
			code = -32000
			await expect(registry.start()).rejects.toThrow('unavailable')
		} finally {
			await client.close()
		}
	})

	it('C2 mirrors tools delivered synchronously with the enable reply', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			const registry = requireValue(page.registry)
			transport.onSend('WebMCP.enable', (message) => {
				transport.reply(message.id, {})
				transport.event(
					'WebMCP.toolsAdded',
					{ tools: [{ name: 'search', description: 'Search', frameId: page.id }] },
					message.sessionId,
				)
			})
			expect(await registry.start()).toBe(true)
			expect(registry.tool('search')?.frame).toBe(page.id)
		} finally {
			await client.close()
		}
	})

	it('C3 mirrors changes, shadowed tools, invocation events, and child navigation', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			const registry = requireValue(page.registry)
			replyOk(transport, 'WebMCP.enable')
			await registry.start()
			const changes = createRecorder<readonly []>()
			registry.emitter.on('change', changes.handler)
			transport.event(
				'WebMCP.toolsAdded',
				{
					tools: [
						{ name: 'search', description: 'Child', frameId: 'child' },
						{ name: 'search', description: 'Main', frameId: page.id },
					],
				},
				'session-1',
			)
			expect(registry.tool('search')?.description).toBe('Main')
			expect(registry.tool('search', 'child')?.description).toBe('Child')
			transport.event(
				'WebMCP.toolsRemoved',
				{ tools: [{ name: 'search', frameId: page.id }] },
				'session-1',
			)
			expect(changes.count).toBe(2)
			expect(registry.tools().map((tool) => tool.frame)).toEqual(['child'])
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'child', url: 'https://example.com/next' } },
				'session-1',
			)
			expect(registry.tools()).toEqual([])
		} finally {
			await client.close()
		}
	})

	it('C4 settles matching synchronous responses with every terminal status', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			const registry = requireValue(page.registry)
			replyOk(transport, 'WebMCP.enable')
			await registry.start()
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: page.id }] },
				'session-1',
			)
			const tool = requireValue(registry.tool('search'))
			let status = 'Completed'
			transport.onSend('WebMCP.invokeTool', (message) => {
				transport.reply(message.id, { invocationId: 'invocation' })
				transport.event(
					'WebMCP.toolResponded',
					{ invocationId: 'foreign', status: 'Completed', output: 'wrong' },
					message.sessionId,
				)
				transport.event(
					'WebMCP.toolResponded',
					{ invocationId: 'invocation', status, output: { found: true }, errorText: 'failure' },
					message.sessionId,
				)
			})
			for (status of ['Completed', 'Error', 'Canceled']) {
				expect(await registry.execute(tool, {})).toEqual({
					id: 'invocation',
					status,
					output: { found: true },
					error: 'failure',
				})
			}
		} finally {
			await client.close()
		}
	})

	it('C4 rejects detached, navigated, and timed out invocations', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			const registry = requireValue(page.registry)
			replyOk(transport, 'WebMCP.enable')
			replyOk(transport, 'WebMCP.invokeTool', { invocationId: 'pending' })
			await registry.start()
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: 'child' }] },
				'session-1',
			)
			const tool = requireValue(registry.tool('search'))
			const detached = registry.execute(tool, {}).catch((error: unknown) => error)
			transport.event('Page.frameDetached', { frameId: 'child' }, 'session-1')
			expect(await detached).toMatchObject({ message: expect.stringContaining('frame') })
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: 'child' }] },
				'session-1',
			)
			const navigated = registry.execute(tool, {}).catch((error: unknown) => error)
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'child', url: 'https://example.com/next' } },
				'session-1',
			)
			expect(await navigated).toMatchObject({ message: expect.stringContaining('frame') })
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: 'child' }] },
				'session-1',
			)
			await expect(registry.execute(tool, {}, { timeout: 10 })).rejects.toThrow('timed out')
		} finally {
			await client.close()
		}
	})

	it('C5 drops foreign responses outside a reply window during a long invocation', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			const registry = requireValue(page.registry)
			replyOk(transport, 'WebMCP.enable')
			let id = 'long'
			transport.onSend('WebMCP.invokeTool', (message) =>
				transport.reply(message.id, { invocationId: id }),
			)
			await registry.start()
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: page.id }] },
				'session-1',
			)
			const tool = requireValue(registry.tool('search'))
			const responses = createRecorder<readonly [BrowserInvocationResult]>()
			registry.emitter.on('respond', responses.handler)
			const pending = registry.execute(tool, {})
			await waitForDelay()
			for (let index = 0; index < 1000; index++) {
				transport.event(
					'WebMCP.toolResponded',
					{ invocationId: `foreign-${index}`, status: 'Completed', output: 'stale' },
					'session-1',
				)
			}
			expect(responses.count).toBe(1000)
			transport.event(
				'WebMCP.toolResponded',
				{ invocationId: 'long', status: 'Completed', output: 'long result' },
				'session-1',
			)
			expect((await pending).output).toBe('long result')
			// Reusing every foreign id makes any retained response observable as a stale settlement.
			for (let index = 0; index < 1000; index++) {
				id = `foreign-${index}`
				const next = registry.execute(tool, {})
				await waitForDelay()
				transport.event(
					'WebMCP.toolResponded',
					{ invocationId: id, status: 'Completed', output: 'fresh' },
					'session-1',
				)
				expect((await next).output).toBe('fresh')
			}
			expect(responses.count).toBe(2001)
		} finally {
			await client.close()
		}
	})

	it('C6 aborts before and after the reply while retaining the invocation id', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			const registry = requireValue(page.registry)
			replyOk(transport, 'WebMCP.enable')
			replyOk(transport, 'WebMCP.cancelInvocation')
			await registry.start()
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: page.id }] },
				'session-1',
			)
			const tool = requireValue(registry.tool('search'))
			const before = new AbortController()
			const rejected = registry
				.execute(tool, {}, { signal: before.signal })
				.catch((error: unknown) => error)
			await waitForCondition('invoke request sent', () =>
				transport.sent.some((message) => message.method === 'WebMCP.invokeTool'),
			)
			const request = requireValue(
				transport.sent.find((message) => message.method === 'WebMCP.invokeTool'),
			)
			before.abort('before')
			expect(await rejected).toBe('before')
			expect(
				transport.sent.filter((message) => message.method === 'WebMCP.cancelInvocation'),
			).toHaveLength(0)
			transport.reply(request.id, { invocationId: 'early' })
			await waitForCondition('late id canceled', () =>
				transport.sent.some((message) => message.params?.['invocationId'] === 'early'),
			)
			const after = new AbortController()
			replyOk(transport, 'WebMCP.invokeTool', { invocationId: 'late' })
			const later = registry
				.execute(tool, {}, { signal: after.signal })
				.catch((error: unknown) => error)
			await waitForDelay()
			after.abort('after')
			expect(await later).toBe('after')
			expect(
				transport.sent
					.filter((message) => message.method === 'WebMCP.cancelInvocation')
					.map((message) => message.params),
			).toEqual([{ invocationId: 'early' }, { invocationId: 'late' }])
			await expect(registry.execute(tool, {}, { signal: after.signal })).rejects.toBe('after')
			expect(
				transport.sent.filter((message) => message.method === 'WebMCP.invokeTool'),
			).toHaveLength(2)
		} finally {
			await client.close()
		}
	})

	it('C7 adopts annotations and synthetic what without forwarding it, and bounds errors', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			const registry = requireValue(page.registry)
			replyOk(transport, 'WebMCP.enable')
			await registry.start()
			transport.event(
				'WebMCP.toolsAdded',
				{
					tools: [
						{
							name: 'empty',
							description: 'Empty',
							frameId: page.id,
							annotations: { readOnly: true, consequential: true, untrustedContent: false },
						},
						{
							name: 'optional',
							description: 'Optional',
							frameId: page.id,
							inputSchema: {
								type: 'object',
								properties: { query: { type: 'string' } },
								required: [],
							},
						},
						{
							name: 'unsafe',
							description: 'Optional what',
							frameId: page.id,
							inputSchema: { type: 'object', properties: { what: { type: 'string' } } },
						},
					],
				},
				'session-1',
			)
			const adopted = await registry.adopt()
			expect(adopted.map((tool) => tool.name)).toEqual(['empty', 'optional'])
			expect(adopted[0]?.annotations).toEqual({ pure: true, consequential: true, untrusted: true })
			let status = 'Completed'
			transport.onSend('WebMCP.invokeTool', (message) => {
				transport.reply(message.id, { invocationId: 'adopted' })
				transport.event(
					'WebMCP.toolResponded',
					{ invocationId: 'adopted', status, output: 'result', errorText: 'x'.repeat(1024 * 1024) },
					message.sessionId,
				)
			})
			for (const tool of adopted) {
				expect(tool.parameters?.['required']).toEqual(['what'])
				expect(
					await tool.execute(
						{ what: 'Read the page', query: 'book' },
						{ signal: new AbortController().signal },
					),
				).toBe('result')
			}
			expect(
				transport.sent
					.filter((message) => message.method === 'WebMCP.invokeTool')
					.map((message) => message.params?.['input']),
			).toEqual([{ query: 'book' }, { query: 'book' }])
			status = 'Error'
			await expect(
				requireValue(adopted[0]).execute(
					{ what: 'Read' },
					{ signal: new AbortController().signal },
				),
			).rejects.toSatisfy(
				(error: unknown) =>
					error instanceof Error && error.message.includes('x') && error.message.length <= 4096,
			)
		} finally {
			await client.close()
		}
	})

	it('C8 disables every enabled session and rejects in-flight invocations on destroy', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			const registry = requireValue(page.registry)
			for (const method of ['WebMCP.enable', 'WebMCP.disable', 'Page.enable', 'Runtime.enable'])
				replyOk(transport, method)
			await registry.start()
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'child-session',
					targetInfo: { targetId: 'child', type: 'iframe', url: 'https://example.com' },
				},
				'session-1',
			)
			await waitForCondition('child registry enabled', () =>
				transport.sent.some(
					(message) => message.method === 'WebMCP.enable' && message.sessionId === 'child-session',
				),
			)
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: 'child' }] },
				'child-session',
			)
			replyOk(transport, 'WebMCP.invokeTool', { invocationId: 'child-call' })
			const navigated = registry
				.execute(requireValue(registry.tool('search')), {})
				.catch((error: unknown) => error)
			await waitForCondition('child invocation sent', () =>
				transport.sent.some((message) => message.method === 'WebMCP.invokeTool'),
			)
			transport.event(
				'Page.frameNavigated',
				{ frame: { id: 'child', url: 'https://example.com/next' } },
				'child-session',
			)
			expect(registry.tools()).toEqual([])
			expect(await navigated).toMatchObject({ message: expect.stringContaining('frame') })
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: 'child' }] },
				'child-session',
			)
			const rejected = registry
				.execute(requireValue(registry.tool('search')), {})
				.catch((error: unknown) => error)
			await waitForCondition(
				'second child invocation sent',
				() =>
					transport.sent.filter((message) => message.method === 'WebMCP.invokeTool').length === 2,
			)
			await registry.destroy()
			expect(await rejected).toMatchObject({ message: expect.stringContaining('destroyed') })
			expect(
				transport.sent
					.filter((message) => message.method === 'WebMCP.disable')
					.map((message) => message.sessionId)
					.sort(),
			).toEqual(['child-session', 'session-1'])
			expect(registry.tools()).toEqual([])
			await expect(registry.start()).rejects.toThrow('destroyed')
		} finally {
			await client.close()
		}
	})

	it('G1 stops the child loop when destroy runs during start', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			for (const method of ['WebMCP.disable', 'Page.enable', 'Runtime.enable'])
				replyOk(transport, method)
			for (const [sessionId, targetId] of [
				['child-a-session', 'child-a'],
				['child-b-session', 'child-b'],
			] as const) {
				transport.event(
					'Target.attachedToTarget',
					{ sessionId, targetInfo: { targetId, type: 'iframe', url: 'https://example.com' } },
					'session-1',
				)
			}
			await waitForDelay()
			transport.sent.length = 0
			let held: number | undefined
			transport.onSend('WebMCP.enable', (message) => {
				if (message.sessionId === 'child-a-session') held = message.id
				else transport.reply(message.id, {})
			})
			const registry = requireValue(page.registry)
			const starting = registry.start().catch((error: unknown) => error)
			await waitForCondition('first child enable pending', () => held !== undefined)
			const destroyed = registry.destroy()
			transport.reply(requireValue(held), {})
			expect(await starting).toMatchObject({ message: expect.stringContaining('destroyed') })
			await destroyed
			expect(
				transport.sent.filter(
					(message) =>
						message.method === 'WebMCP.enable' && message.sessionId === 'child-b-session',
				),
			).toHaveLength(0)
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: 'child-b' }] },
				'child-b-session',
			)
			expect(registry.tools()).toEqual([])
		} finally {
			await client.close()
		}
	})

	it('G3 keeps the registry running when a child enable fails during start', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			for (const method of ['Page.enable', 'Runtime.enable']) replyOk(transport, method)
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'child-session',
					targetInfo: { targetId: 'child', type: 'iframe', url: 'https://example.com' },
				},
				'session-1',
			)
			await waitForDelay()
			transport.onSend('WebMCP.enable', (message) => {
				if (message.sessionId === 'child-session')
					transport.fail(message.id, 'Session with given id not found', -32001)
				else transport.reply(message.id, {})
			})
			const registry = requireValue(page.registry)
			expect(await registry.start()).toBe(true)
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: page.id }] },
				'session-1',
			)
			expect(registry.tools()).toHaveLength(1)
			transport.onSend('WebMCP.enable', (message) => transport.reply(message.id, {}))
			transport.event(
				'Target.attachedToTarget',
				{
					sessionId: 'later-session',
					targetInfo: { targetId: 'later', type: 'iframe', url: 'https://example.com' },
				},
				'session-1',
			)
			await waitForCondition('later session enabled', () =>
				transport.sent.some(
					(message) => message.method === 'WebMCP.enable' && message.sessionId === 'later-session',
				),
			)
		} finally {
			await client.close()
		}
	})

	it('G5 clears held responses when the reply window closes', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			const registry = requireValue(page.registry)
			replyOk(transport, 'WebMCP.enable')
			await registry.start()
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: page.id }] },
				'session-1',
			)
			const tool = requireValue(registry.tool('search'))
			const first = registry.execute(tool, {})
			await waitForCondition('first invoke sent', () =>
				transport.sent.some((message) => message.method === 'WebMCP.invokeTool'),
			)
			const request = requireValue(
				transport.sent.find((message) => message.method === 'WebMCP.invokeTool'),
			)
			transport.event(
				'WebMCP.toolResponded',
				{ invocationId: 'F', status: 'Completed', output: 'held' },
				'session-1',
			)
			transport.reply(request.id, { invocationId: 'one' })
			transport.event(
				'WebMCP.toolResponded',
				{ invocationId: 'one', status: 'Completed', output: 'one result' },
				'session-1',
			)
			expect((await first).output).toBe('one result')
			replyOk(transport, 'WebMCP.invokeTool', { invocationId: 'F' })
			let settled = false
			const second = registry.execute(tool, {}).then((result) => {
				settled = true
				return result
			})
			await waitForDelay()
			expect(settled).toBe(false)
			transport.event(
				'WebMCP.toolResponded',
				{ invocationId: 'F', status: 'Completed', output: 'fresh' },
				'session-1',
			)
			expect((await second).output).toBe('fresh')
		} finally {
			await client.close()
		}
	})

	it('G10 cancels a timed out invocation whose id is known', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			const registry = requireValue(page.registry)
			replyOk(transport, 'WebMCP.enable')
			replyOk(transport, 'WebMCP.cancelInvocation')
			replyOk(transport, 'WebMCP.invokeTool', { invocationId: 'slow' })
			await registry.start()
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: page.id }] },
				'session-1',
			)
			await expect(
				registry.execute(requireValue(registry.tool('search')), {}, { timeout: 50 }),
			).rejects.toThrow('timed out')
			await waitForCondition('timeout canceled', () =>
				transport.sent.some((message) => message.method === 'WebMCP.cancelInvocation'),
			)
			expect(
				transport.sent.find((message) => message.method === 'WebMCP.cancelInvocation')?.params,
			).toEqual({ invocationId: 'slow' })
		} finally {
			await client.close()
		}
	})

	it('G10 cancels a timed out invocation after its late reply arrives', async () => {
		const { page, client, transport } = await createAttachedPage()
		try {
			const registry = requireValue(page.registry)
			replyOk(transport, 'WebMCP.enable')
			replyOk(transport, 'WebMCP.cancelInvocation')
			await registry.start()
			transport.event(
				'WebMCP.toolsAdded',
				{ tools: [{ name: 'search', description: 'Search', frameId: page.id }] },
				'session-1',
			)
			const rejected = registry
				.execute(requireValue(registry.tool('search')), {}, { timeout: 50 })
				.catch((error: unknown) => error)
			await waitForCondition('invoke request sent', () =>
				transport.sent.some((message) => message.method === 'WebMCP.invokeTool'),
			)
			const request = requireValue(
				transport.sent.find((message) => message.method === 'WebMCP.invokeTool'),
			)
			expect(await rejected).toMatchObject({ message: expect.stringContaining('timed out') })
			expect(
				transport.sent.filter((message) => message.method === 'WebMCP.cancelInvocation'),
			).toHaveLength(0)
			transport.reply(request.id, { invocationId: 'late' })
			await waitForCondition('late id canceled', () =>
				transport.sent.some((message) => message.method === 'WebMCP.cancelInvocation'),
			)
			expect(
				transport.sent.find((message) => message.method === 'WebMCP.cancelInvocation')?.params,
			).toEqual({ invocationId: 'late' })
		} finally {
			await client.close()
		}
	})
})
