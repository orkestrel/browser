import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRecord } from '@orkestrel/contract'
import { createMCPClient } from '@orkestrel/mcp'
import { createStdioClientTransport } from '@orkestrel/mcp/server'
import { createTeardown, waitForCondition } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { describe, expect, it } from 'vitest'
import { BROWSE_VOCABULARY, BrowseChild } from '../../setupServer.js'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BUILT_ENTRY = resolve(ROOT, 'dist/bin/main.js')
const INITIALIZE = {
	jsonrpc: '2.0',
	id: 1,
	method: 'initialize',
	params: {
		protocolVersion: '2025-06-18',
		capabilities: {},
		clientInfo: { name: 'browse-bin-test', version: '1.0.0' },
	},
}
const LIST = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }

describe('bin entry', () => {
	it('is the built file the manifest names as browse, with the shebang npm reads', () => {
		const manifest: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
		const bin = isRecord(manifest) ? manifest['bin'] : undefined
		expect(isRecord(bin) ? resolve(ROOT, String(bin['browse'])) : undefined).toBe(BUILT_ENTRY)
		expect(readFileSync(BUILT_ENTRY, 'utf8').split(/\r\n|\n/u)[0]).toBe('#!/usr/bin/env node')
	})

	it(
		'lists the vocabulary to the modern mcp stdio client and refuses its first call with Chromium absent',
		{ timeout: 60_000 },
		async () => {
			const scratch = createScratch()
			const root = join(scratch.path, 'tmp/browsers')
			const client = createMCPClient({
				transport: createStdioClientTransport({
					command: process.execPath,
					args: [BUILT_ENTRY],
					env: {
						BROWSE_ROOT: root,
						BROWSE_EXECUTABLE: join(scratch.path, 'missing/chrome'),
						BROWSE_HEADLESS: 'true',
						BROWSE_READONLY: 'false',
					},
				}),
				identity: { name: 'browse-bin-test', version: '1.0.0' },
			})
			const teardown = createTeardown()
			teardown.add(() => scratch.destroy())
			teardown.add(() => client.disconnect())
			try {
				await client.connect()
				const tools = await client.tools()
				expect(tools.map((tool) => tool.name)).toStrictEqual(BROWSE_VOCABULARY)
				await expect(client.call('look', { search: 'the page' })).rejects.toThrow(
					/BROWSER_SERVER_UNAVAILABLE:.*ENOENT/u,
				)
				expect(readdirSync(join(root, '.profiles'))).toStrictEqual([])
				// Closing the client signals the child, and a later call is refused without reaching it.
				await client.disconnect()
				await expect(client.call('look', { search: 'the page' })).rejects.toThrow(
					"MCP client is not connected, so 'tools/call' was not issued",
				)
			} finally {
				await teardown.destroy()
			}
		},
	)

	it('refuses a missing executable on each surface and exits 1 after input ends', async () => {
		const scratch = createScratch()
		const child = new BrowseChild(BUILT_ENTRY, scratch.path, {
			BROWSE_EXECUTABLE: join(scratch.path, 'missing/chrome'),
		})
		const teardown = createTeardown()
		teardown.add(() => scratch.destroy())
		teardown.add(() => child.destroy())
		try {
			child.send(
				INITIALIZE,
				LIST,
				{
					jsonrpc: '2.0',
					id: 3,
					method: 'tools/call',
					params: { name: 'look', arguments: { search: 'the page' } },
				},
				{ jsonrpc: '2.0', id: 4, method: 'ping', params: {} },
			)
			await waitForCondition('four answers', () => child.lines.length === 4, {
				budget: 15_000,
				interval: 10,
			})
			const answers = child.lines.map((line): unknown => JSON.parse(line))
			expect(answers).toContainEqual({
				jsonrpc: '2.0',
				id: 1,
				error: {
					code: -32000,
					data: { code: 'BROWSER_SERVER_UNAVAILABLE' },
					message: expect.stringMatching(/^BROWSER_SERVER_UNAVAILABLE:.*ENOENT/u),
				},
			})
			const discovery = answers.find((answer) => isRecord(answer) && answer['id'] === 2)
			const result = isRecord(discovery) ? discovery['result'] : undefined
			const tools = isRecord(result) ? result['tools'] : undefined
			expect(
				Array.isArray(tools)
					? tools.map((tool: unknown) => (isRecord(tool) ? tool['name'] : undefined))
					: undefined,
			).toEqual(BROWSE_VOCABULARY)
			expect(answers).toContainEqual({ jsonrpc: '2.0', id: 4, result: {} })
			expect(answers).toContainEqual(
				expect.objectContaining({
					id: 3,
					result: {
						isError: true,
						content: [
							{
								type: 'text',
								text: expect.stringMatching(/^BROWSER_SERVER_UNAVAILABLE:.*ENOENT/u),
							},
						],
					},
				}),
			)
			// The failed launch made and removed its profile under the default root in this directory.
			expect(readdirSync(join(scratch.path, 'tmp/browsers/.profiles'))).toStrictEqual([])
			child.end()
			expect(await child.ending).toStrictEqual({ code: 1, signal: null })
			const diagnostics = child.stderr.split(/\r\n|\n/u).filter((line) => line !== '')
			expect(diagnostics).toEqual([
				expect.stringMatching(/^browse: BROWSER_SERVER_LAUNCH:.*ENOENT/u),
				expect.stringMatching(/^browse: BROWSER_SERVER_LAUNCH:.*ENOENT/u),
				expect.stringMatching(/^browse: BROWSER_SERVER_UNAVAILABLE:.*ENOENT/u),
			])
			for (const line of diagnostics) expect(line.match(/BROWSER_SERVER_\w+/gu)).toHaveLength(1)
		} finally {
			await teardown.destroy()
		}
	})

	for (const value of ['two', '1.5', 'NaN', 'Infinity']) {
		it(`refuses non-integer BROWSE_POOL=${value} with ENVIRONMENT`, async () => {
			const scratch = createScratch()
			const child = new BrowseChild(BUILT_ENTRY, scratch.path, { BROWSE_POOL: value })
			try {
				expect(await child.ending).toStrictEqual({ code: 1, signal: null })
				expect(child.lines).toEqual([])
				expect(child.stderr).toBe(
					`browse: BROWSER_SERVER_ENVIRONMENT: BROWSE_POOL must be an integer, not "${value}"\n`,
				)
			} finally {
				await child.destroy()
				scratch.destroy()
			}
		})
	}
	for (const value of ['0', '4', '-1']) {
		it(`refuses out-of-range BROWSE_POOL=${value} with OPTIONS`, async () => {
			const scratch = createScratch()
			const child = new BrowseChild(BUILT_ENTRY, scratch.path, { BROWSE_POOL: value })
			try {
				expect(await child.ending).toStrictEqual({ code: 1, signal: null })
				expect(child.lines).toEqual([])
				expect(child.stderr).toBe(
					'browse: BROWSER_SERVER_OPTIONS: pool.size must be an integer from 1 through 3\n',
				)
			} finally {
				await child.destroy()
				scratch.destroy()
			}
		})
	}

	it('refuses a malformed flag with one line and exit code 1', async () => {
		const scratch = createScratch()
		const child = new BrowseChild(BUILT_ENTRY, scratch.path, { BROWSE_HEADLESS: 'sometimes' })
		const teardown = createTeardown()
		teardown.add(() => scratch.destroy())
		teardown.add(() => child.destroy())
		try {
			expect(await child.ending).toStrictEqual({ code: 1, signal: null })
			expect(child.stderr).toBe(
				'browse: BROWSER_SERVER_ENVIRONMENT: BROWSE_HEADLESS must be true, false, 1, or 0, not "sometimes"\n',
			)
			expect(child.lines).toStrictEqual([])
		} finally {
			await teardown.destroy()
		}
	})
})
