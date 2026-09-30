import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { requireValue, waitForCondition } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { parseBrowserTool, parseBrowserInvocationResult } from '@src/core'
import { createBrowserElementFixture, replyOk } from './setup.js'
import {
	WEBMCP_DOMAIN_ROWS,
	WEBMCP_SOURCE_ROWS,
	WEBMCP_WEBREF_ROWS,
	WEBMCP_GAPS,
	WEBMCP_PROTOCOL,
	WEBMCP_TOOL,
	WEBMCP_TOOL_FIELDS,
	WEBMCP_ANNOTATION_FIELDS,
	WEBMCP_REMOVAL_FIELDS,
	WEBMCP_INVOCATION_FIELDS,
	WEBMCP_RESULT_FIELDS,
	WEBMCP_MAPPING_ROWS,
	WEBMCP_STATUS_ROWS,
	WEBMCP_SKIP_ROWS,
	WEBMCP_EXPORT_CONTROL,
	readConformanceExports,
	readDomainRecord,
	readDomainRecords,
	readConformanceDrift,
} from './setupConformance.js'

describe('pinned WebMCP conformance', () => {
	it.each([...WEBMCP_DOMAIN_ROWS, ...WEBMCP_SOURCE_ROWS, ...WEBMCP_WEBREF_ROWS, ...WEBMCP_GAPS])(
		'$symbol ($ruling)',
		(row) => {
			expect(
				readConformanceDrift(row.symbol, row.expected, 'pinned mirror / package model', row.model),
			).toBeUndefined()
			expect(row.ruling === 'implement' || Boolean(row.closer)).toBe(true)
		},
	)

	it('reads no parser field absent from its mirror and covers every nonexcluded field', () => {
		for (const [name, fields] of [
			['Tool', WEBMCP_TOOL_FIELDS],
			['Annotation', WEBMCP_ANNOTATION_FIELDS],
			['RemovedTool', WEBMCP_REMOVAL_FIELDS],
		] as const) {
			const properties = readDomainRecords(
				readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'types'), name),
				'properties',
			)
			expect(fields).toEqual(
				properties
					.map((property) => property['name'])
					.filter((field) => field !== 'stackTrace')
					.sort(),
			)
		}
		for (const [name, fields] of [
			['toolInvoked', WEBMCP_INVOCATION_FIELDS],
			['toolResponded', WEBMCP_RESULT_FIELDS],
		] as const) {
			expect(fields).toEqual(
				readDomainRecords(
					readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'events'), name),
					'parameters',
				)
					.map((property) => property['name'])
					.sort(),
			)
		}
		expect(parseBrowserTool(WEBMCP_TOOL)).toEqual({
			name: 'search-cars',
			description: 'Search cars',
			frame: 'main',
			node: 50,
			schema: WEBMCP_TOOL.inputSchema,
			annotation: WEBMCP_TOOL.annotations,
		})
		expect(parseBrowserTool(WEBMCP_TOOL)).not.toHaveProperty('stackTrace')
	})

	it('uses exactly the mirror commands and event subscriptions', () => {
		const source = readFileSync(new URL('../src/core/BrowserRegistry.ts', import.meta.url), 'utf8')
		const commands = readDomainRecords(WEBMCP_PROTOCOL, 'commands')
			.map((entry) => entry['name'])
			.sort()
		const events = readDomainRecords(WEBMCP_PROTOCOL, 'events')
			.map((entry) => entry['name'])
			.sort()
		const subscribed = [...source.matchAll(/subscriptions\.set\('WebMCP\.(\w+)'/g)]
			.map((match) => match[1])
			.sort()
		const named = [
			...new Set([...source.matchAll(/'WebMCP\.(\w+)'/g)].map((match) => match[1])),
		].sort()
		expect(subscribed).toEqual(events)
		expect(named).toEqual([...commands, ...events].sort())
	})

	it.each(WEBMCP_STATUS_ROWS)(
		'$symbol is parsed and settled by the registry ($ruling)',
		async (row) => {
			expect(
				readConformanceDrift(row.symbol, row.expected, 'InvocationStatus', row.model),
			).toBeUndefined()
			const fixture = await createBrowserElementFixture({
				registry: (message) => fixture.transport.reply(message.id, {}),
			})
			try {
				await fixture.page.registry.start()
				fixture.transport.event('WebMCP.toolsAdded', { tools: [WEBMCP_TOOL] }, 'session-main')
				replyOk(fixture.transport, 'WebMCP.invokeTool', { invocationId: 'call' })
				const pending = fixture.page.registry.execute(
					requireValue(fixture.page.registry.tool('search-cars')),
					{},
				)
				const settled = pending.then(
					(result) => result.status,
					(error: unknown) => error,
				)
				await waitForCondition('invoke request', () =>
					fixture.transport.sent.some((message) => message.method === 'WebMCP.invokeTool'),
				)
				fixture.transport.event(
					'WebMCP.toolResponded',
					{ invocationId: 'call', status: row.symbol, output: 'cars' },
					'session-main',
				)
				expect(
					parseBrowserInvocationResult({ invocationId: 'call', status: row.symbol })?.status,
				).toBe(row.symbol)
				expect(await settled).toBe(row.symbol)
				const adopted = requireValue((await fixture.page.registry.adopt())[0])
				const execution = Promise.resolve(
					adopted.execute({ what: 'cars' }, { signal: new AbortController().signal }),
				).catch((error: unknown) => error)
				await waitForCondition(
					'adopted invoke request',
					() =>
						fixture.transport.sent.filter((message) => message.method === 'WebMCP.invokeTool')
							.length === 2,
				)
				fixture.transport.event(
					'WebMCP.toolResponded',
					{ invocationId: 'call', status: row.symbol, output: 'cars' },
					'session-main',
				)
				const outcome = await execution
				expect(row.symbol === 'Completed' ? outcome : outcome instanceof Error).toBe(
					row.symbol === 'Completed' ? 'cars' : true,
				)
			} finally {
				await fixture.client.close()
			}
		},
	)

	it.each([...WEBMCP_MAPPING_ROWS, ...WEBMCP_SKIP_ROWS])(
		'$symbol observes the ruled model ($ruling)',
		async (row) => {
			const observed = { ...row, model: await row.model(row.input) }
			expect(
				readConformanceDrift(
					observed.symbol,
					observed.model,
					'ruled expectation',
					observed.expected,
				),
			).toBeUndefined()
			expect(observed.ruling === 'implement' || Boolean(observed.closer)).toBe(true)
		},
	)

	it('marks a registered backend form as e5 and removes the mark after tool removal', async () => {
		let disabled = false
		const fixture = await createBrowserElementFixture({
			registry: (message) => fixture.transport.reply(message.id, {}),
			accessibility: (message) =>
				fixture.transport.reply(message.id, {
					nodes: Array.from({ length: 5 }, (_, index) => ({
						nodeId: String(index),
						backendDOMNodeId: index === 4 ? 50 : index + 1,
						role: { value: index === 4 ? 'form' : 'button' },
						name: { value: index === 4 ? 'Search cars' : `Button ${index}` },
						properties: [{ name: 'disabled', value: { value: index === 4 && disabled } }],
					})),
				}),
		})
		try {
			await fixture.page.registry.start()
			fixture.transport.event('WebMCP.toolsAdded', { tools: [WEBMCP_TOOL] }, 'session-main')
			const outline = await fixture.page.elements.outline()
			expect(outline.text.split('\n')).toContain('e5 form "Search cars" [tool=search-cars]')
			expect(outline.text).not.toContain('autosubmit')
			disabled = true
			expect((await fixture.page.elements.outline()).text.split('\n')).toContain(
				'e5 form "Search cars" [disabled] [tool=search-cars]',
			)
			fixture.transport.event(
				'WebMCP.toolsRemoved',
				{ tools: [{ name: 'search-cars', frameId: 'main' }] },
				'session-main',
			)
			expect((await fixture.page.elements.outline()).text).not.toContain('[tool=')
		} finally {
			await fixture.client.close()
		}
	})

	it('exports no WebMCP or ModelContext name from src', () => {
		const exports = readConformanceExports([
			'src/core/index.ts',
			'src/server/index.ts',
			'src/browser/index.ts',
		])
		expect(exports.get('src/core/index.ts')).toContain('BrowserPage')
		expect(exports.get('src/server/index.ts')).toContain('Browser')
		expect(exports.get('src/browser/index.ts')).toContain('createDocumentToolset')
		for (const names of exports.values()) {
			expect(names.filter((name) => /WebMCP|ModelContext/.test(name))).toEqual([])
			expect(names).not.toContain('default')
		}
	})

	it('follows star-export chains to forbidden clauses and comment-separated declarations', () => {
		const scratch = createScratch({
			parent: 'tmp',
			prefix: 'u17-exports-',
			files: WEBMCP_EXPORT_CONTROL,
		})
		try {
			const path = join(scratch.path, 'index.ts')
			const names = requireValue(readConformanceExports([path]).get(path))
			expect(names.filter((name) => /WebMCP|ModelContext/.test(name))).toEqual([
				'BrowserModelContext',
				'ModelContextThing',
			])
		} finally {
			scratch.destroy()
		}
	})
})
