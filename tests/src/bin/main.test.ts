import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isRecord } from '@orkestrel/contract'
import { createMCPClient } from '@orkestrel/mcp'
import { createStdioClientTransport } from '@orkestrel/mcp/server'
import { createTeardown, waitForCondition } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { describe, expect, it } from 'vitest'
import { BROWSE_VOCABULARY, BrowseChild, COOPERATIVE_SIGTERM } from '../../setupServer.js'

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
		'lists the vocabulary to the mcp stdio client with Chromium absent, then refuses after the client closes',
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
				await expect(client.call('look', { search: 'the page' })).rejects.toThrow(/ENOENT/u)
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

	it('answers discovery in its working directory and exits 0 at the end of its input', async () => {
		const scratch = createScratch()
		const child = new BrowseChild(BUILT_ENTRY, scratch.path, {
			BROWSE_EXECUTABLE: join(scratch.path, 'missing/chrome'),
		})
		const teardown = createTeardown()
		teardown.add(() => scratch.destroy())
		teardown.add(() => child.destroy())
		try {
			child.send(INITIALIZE, LIST, {
				jsonrpc: '2.0',
				id: 3,
				method: 'tools/call',
				params: { name: 'look', arguments: { search: 'the page' } },
			})
			await waitForCondition('three answers', () => child.lines.length === 3, {
				budget: 15_000,
				interval: 10,
			})
			const answers = child.lines.map((line): unknown => JSON.parse(line))
			expect(answers).toContainEqual(
				expect.objectContaining({ id: 3, result: expect.objectContaining({ isError: true }) }),
			)
			// The failed launch made and removed its profile under the default root in this directory.
			expect(readdirSync(join(scratch.path, 'tmp/browsers/.profiles'))).toStrictEqual([])
			child.end()
			expect(await child.ending).toStrictEqual({ code: 0, signal: null })
			expect(child.stderr).toBe('')
		} finally {
			await teardown.destroy()
		}
	})

	// Node ends a child outright when it signals it on Windows, so no handler runs there.
	it.runIf(COOPERATIVE_SIGTERM)('destroys itself and exits 0 on SIGTERM', async () => {
		const scratch = createScratch()
		const child = new BrowseChild(BUILT_ENTRY, scratch.path, {
			BROWSE_EXECUTABLE: join(scratch.path, 'missing/chrome'),
		})
		const teardown = createTeardown()
		teardown.add(() => scratch.destroy())
		teardown.add(() => child.destroy())
		try {
			child.send(INITIALIZE, LIST)
			await waitForCondition('two answers', () => child.lines.length === 2, {
				budget: 15_000,
				interval: 10,
			})
			child.kill('SIGTERM')
			expect(await child.ending).toStrictEqual({ code: 0, signal: null })
			expect(existsSync(join(scratch.path, 'tmp/browsers'))).toBe(false)
		} finally {
			await teardown.destroy()
		}
	})

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
