/**
 * Proof for `tests/setupService.ts`.
 *
 * The subject is the readiness contract the `service` project codes against: the shared
 * container-safe launch flags, the engine narrowing read from the environment, the
 * hard-required resolution that throws rather than skipping, the cited reason a live proof
 * may skip with, and the readers of a protocol domain list, an outline's references and rows,
 * and a tool result's text.
 *
 * Every case runs on any host, browserless included, because this file is collected by
 * the `setup` project that `npm test` runs. The refusal path is driven by handing
 * discovery candidate sources that resolve nothing, so the assertion never depends on
 * what happens to be installed. The last case reads the `tests/service` sources directly
 * and pins that each proof there resolves its browser through `requireSystemBrowser` and
 * that its only skip is conditional on a registry reading and names a reason exported here,
 * which is what keeps a later service proof from reintroducing a silent skip.
 */

import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserOutlineNode } from '@src/core'
import { BROWSER_TOOL_DEADLINE_NOTE, renderBrowserOutline } from '@src/core'
import { isString } from '@orkestrel/contract'
import { createTool, createToolManager } from '@orkestrel/tool'
import { createScratch } from '@orkestrel/test/server'
import { createCDPTestServer, createBrowseFixture, waitForProcessExit } from './setupServer.js'
import { BROWSER_SERVER_RECORD } from '@src/server'
import { requireValue } from '@orkestrel/test'
import * as setupService from './setupService.js'
import {
	collectOutlinePairs,
	collectOutlineEntries,
	extractOutlineReferences,
	extractOutlineRows,
	matchesToolReceipt,
	requireDocumentToolset,
	parseProtocolDomains,
	REGISTRY_ABSENT_REASON,
	requireCacheRestore,
	requireOutlineReference,
	requireSystemBrowser,
	requireToolText,
	resolveServiceEngine,
	scanServiceSkips,
	SERVICE_BROWSER_ARGS,
	SERVICE_CHANGED_NOTE,
	SERVICE_ENGINE_ENV_KEY,
	SERVICE_REGISTRY_ARGS,
	BrowseLauncher,
	createEagerBrowseChild,
	BROWSE_RECORD_BLOCKS,
} from './setupService.js'

const SERVICE_DIRECTORY = fileURLToPath(new URL('service/', import.meta.url))

describe('eager browse service fixtures', () => {
	it('records real Browser connections independently of browser availability', async () => {
		const peer = await createCDPTestServer()
		const launcher = new BrowseLauncher()
		const options = { cdp: { endpoint: peer.endpoint } }
		const browser = launcher.launch(options)
		try {
			expect(launcher.connections).toEqual([])
			await browser.connect()
			expect(launcher.browsers).toEqual([browser])
			expect(launcher.connections).toEqual([{ pid: browser.pid, endpoint: peer.endpoint, options }])
		} finally {
			await browser.destroy()
			await peer.close()
		}
	})
	it('loads the source server in its child and reports the missing executable', async () => {
		const scratch = createScratch()
		const child = createEagerBrowseChild(scratch.path, join(scratch.path, 'absent-browser.exe'))
		try {
			await child.ending
			expect(child.stderr).toContain('ENOENT')
			expect(child.lines).not.toContain('ready')
		} finally {
			await child.destroy()
			scratch.destroy()
		}
	})
	for (const blocked of BROWSE_RECORD_BLOCKS) {
		it(`makes record obstruction ${blocked} refuse a warm`, async () => {
			const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], {
				stdio: ['pipe', 'ignore', 'ignore'],
				windowsHide: true,
			})
			const pid = requireValue(child.pid, 'owned record process')
			const fixture = createBrowseFixture(
				{
					launch: (options) => {
						mkdirSync(join(requireValue(options.profile, 'profile'), blocked))
						return fixture.launcher.launch(options)
					},
				},
				{ pid },
			)
			try {
				await expect(fixture.server.start()).rejects.toMatchObject({
					code: 'BROWSER_SERVER_UNAVAILABLE',
				})
				expect(fixture.launcher.browsers.every((browser) => browser.destroyed)).toBe(true)
				expect(readdirSync(join(fixture.root, '.profiles'))).toEqual([])
				expect([BROWSER_SERVER_RECORD, `${BROWSER_SERVER_RECORD}.tmp`]).toContain(blocked)
			} finally {
				child.kill()
				await waitForProcessExit(pid)
				await fixture.teardown.destroy()
			}
		})
	}
})

describe('collectOutlineEntries', () => {
	it('retains suffixes and duplicate names, deduplicates references, and ignores nonrows', () => {
		expect(
			collectOutlineEntries(
				'2 elements match "Toggle":\r\ne9 button "Toggle" pressed=false\r\npage "Title" url\r\ne2 button "Toggle" pressed=true [disabled]\r\ne9 button "Toggle" pressed=false\r\n# Heading\r\ne0 button "Invalid"\r\ne3 no-quoted-name\r\n(2 of 2 elements)',
			),
		).toEqual(['button "Toggle" pressed=false', 'button "Toggle" pressed=true [disabled]'])
		expect(collectOutlineEntries('page "Title" url\n(0 of 0 elements)')).toEqual([])
	})
})

describe('SERVICE_BROWSER_ARGS', () => {
	it('carries the container-safe flags as a frozen list', () => {
		expect([...SERVICE_BROWSER_ARGS]).toStrictEqual([
			'--no-sandbox',
			'--disable-dev-shm-usage',
			'--disable-gpu',
		])
		expect(Object.isFrozen(SERVICE_BROWSER_ARGS)).toBe(true)
	})
})

describe('SERVICE_ENGINE_ENV_KEY', () => {
	it('names the environment variable the compatibility matrix sets', () => {
		expect(SERVICE_ENGINE_ENV_KEY).toBe('BROWSER_COMPATIBILITY_ENGINE')
	})
})

describe('resolveServiceEngine', () => {
	it('accepts each supported engine name', () => {
		expect(resolveServiceEngine('chromium')).toBe('chromium')
		expect(resolveServiceEngine('chrome')).toBe('chrome')
		expect(resolveServiceEngine('edge')).toBe('edge')
	})

	it('leaves discovery open for an absent, empty, or unsupported value', () => {
		expect(resolveServiceEngine(undefined)).toBeUndefined()
		expect(resolveServiceEngine('')).toBeUndefined()
		expect(resolveServiceEngine('firefox')).toBeUndefined()
		expect(resolveServiceEngine('Chrome')).toBeUndefined()
	})
})

describe('requireSystemBrowser', () => {
	it('throws a message naming the install routes when every candidate source is empty', () => {
		expect(() => requireSystemBrowser({ env: {}, paths: [], names: [], stores: [] })).toThrow(
			'The service project requires a Chromium-family browser on this host and found none.',
		)
		expect(() => requireSystemBrowser({ env: {}, paths: [], names: [], stores: [] })).toThrow(
			'PLAYWRIGHT_EXECUTABLE_PATH or CHROME_PATH',
		)
	})

	it('returns the executable an explicit candidate path supplies', () => {
		const executable = fileURLToPath(new URL('setupService.ts', import.meta.url))

		expect(
			requireSystemBrowser({ env: {}, paths: [executable], names: [], stores: [] }),
		).toStrictEqual({ executable, engine: 'chromium' })
	})
})

describe('REGISTRY_ABSENT_REASON', () => {
	it('cites the protocol error code and the command refusal a live proof asserts before skipping', () => {
		expect(REGISTRY_ABSENT_REASON).toContain('WebMCP.enable answers CDP error -32601')
		expect(REGISTRY_ABSENT_REASON).toContain('method not found')
	})
})

describe('parseProtocolDomains', () => {
	it('returns the listed domain names in reply order', () => {
		expect(
			parseProtocolDomains({
				domains: [
					{ name: 'Page', version: '1.3' },
					{ name: 'WebMCP', version: '1.3' },
				],
			}),
		).toStrictEqual(['Page', 'WebMCP'])
		expect(parseProtocolDomains({ domains: [] })).toStrictEqual([])
	})

	it('refuses a reply with no domain list or a domain with no string name', () => {
		expect(parseProtocolDomains(undefined)).toBeUndefined()
		expect(parseProtocolDomains([])).toBeUndefined()
		expect(parseProtocolDomains({ domains: { name: 'Page' } })).toBeUndefined()
		expect(
			parseProtocolDomains({ domains: [{ name: 'Page' }, { version: '1.3' }] }),
		).toBeUndefined()
		expect(parseProtocolDomains({ domains: [{ name: 7 }] })).toBeUndefined()
		expect(parseProtocolDomains({ domains: ['Page'] })).toBeUndefined()
	})
})

describe('extractOutlineReferences', () => {
	it('reads the reference of every element row the outline renderer writes, in row order', () => {
		const nodes: readonly BrowserOutlineNode[] = [
			['7', 'textbox', 'Name', 'e3'],
			['8', 'heading', 'Delivery form', undefined],
			['9', 'button', 'Submit', 'e12'],
		].map(([id, role, name, reference]) => ({
			id: id ?? '',
			parent: undefined,
			children: [],
			backend: Number(id),
			frame: 'main',
			ignored: false,
			role,
			name,
			description: undefined,
			value: undefined,
			properties: {},
			session: 'session',
			reference,
		}))
		const outline = renderBrowserOutline('http://127.0.0.1/form', 'Delivery form', nodes, 150)

		expect(extractOutlineReferences(outline.text)).toStrictEqual([3, 12])
	})

	it('extracts nothing from heading, text, and summary rows or from an empty outline', () => {
		expect(
			extractOutlineReferences(
				'page "Form" http://127.0.0.1/form\n# e5 heading\ne0 zero\nLeave e7 at the door\n(0 of 0 elements)',
			),
		).toStrictEqual([])
		expect(extractOutlineReferences('')).toStrictEqual([])
	})
})

describe('extractOutlineRows', () => {
	it('reads the reference, role, and decoded name of every element row the outline renderer writes', () => {
		const nodes: readonly BrowserOutlineNode[] = [
			['7', 'textbox', 'Name', 'e3'],
			['8', 'heading', 'Delivery form', undefined],
			['9', 'button', 'Say "hi" \\ bye', 'e12'],
			['10', 'Iframe', 'Voucher form', 'e13'],
		].map(([id, role, name, reference]) => ({
			id: id ?? '',
			parent: undefined,
			children: [],
			backend: Number(id),
			frame: 'main',
			ignored: false,
			role,
			name,
			description: undefined,
			value: undefined,
			properties: {},
			session: 'session',
			reference,
		}))
		const outline = renderBrowserOutline('http://127.0.0.1/form', 'Delivery form', nodes, 150)

		expect(extractOutlineRows(outline.text)).toStrictEqual([
			{ reference: 'e3', role: 'textbox', name: 'Name' },
			{ reference: 'e12', role: 'button', name: 'Say "hi" \\ bye' },
			{ reference: 'e13', role: 'Iframe', name: 'Voucher form' },
		])
	})

	it('reads the rows of a receipt and nothing from heading, text, summary, or unquoted rows', () => {
		expect(
			extractOutlineRows(
				'Clicked e2 button "Keep".\n\npage "Drafts" http://127.0.0.1/confirm\n# Drafts\ne1 button "Delete"\ne0 button "Zero"\ne4 option\nLeave e7 at the door\n(1 of 1 elements)',
			),
		).toStrictEqual([{ reference: 'e1', role: 'button', name: 'Delete' }])
		expect(extractOutlineRows('')).toStrictEqual([])
	})

	it('reads a look match row that repeats an outline row once, at its first occurrence', () => {
		expect(
			extractOutlineRows(
				'1 element matches "the delete button":\ne1 button "Delete"\n\npage "Drafts" http://127.0.0.1/confirm\ne2 button "Keep"\ne1 button "Delete"\n(2 of 2 elements)',
			),
		).toStrictEqual([
			{ reference: 'e1', role: 'button', name: 'Delete' },
			{ reference: 'e2', role: 'button', name: 'Keep' },
		])
	})
})

describe('collectOutlinePairs', () => {
	it('collects equal sorted lists from two outlines listing the same elements in another order under other references', () => {
		const cdp =
			'page "Gift" u\ne1 link "Desk"\ne2 checkbox "Gift wrap"\ne3 button "Apply"\n(3 of 3 elements)'
		const dom =
			'page "Gift" u\ne9 button "Apply"\nGift wrap\ne7 checkbox "Gift wrap"\ne8 link "Desk"\n(3 of 3 elements)'

		expect(collectOutlinePairs(cdp)).toStrictEqual([
			'button "Apply"',
			'checkbox "Gift wrap"',
			'link "Desk"',
		])
		expect(collectOutlinePairs(dom)).toStrictEqual(collectOutlinePairs(cdp))
		expect(collectOutlinePairs(`${dom}\ne10 option "Small"`)).not.toStrictEqual(
			collectOutlinePairs(cdp),
		)
		expect(collectOutlinePairs('(0 of 0 elements)')).toStrictEqual([])
		expect(
			collectOutlinePairs(`1 element matches "gift wrap":\ne7 checkbox "Gift wrap"\n\n${dom}`),
		).toStrictEqual(collectOutlinePairs(cdp))
	})
})

describe('requireOutlineReference', () => {
	const text =
		'page "Drafts" u\ne1 button "Delete"\ne2 button "Keep"\ne3 link "Keep"\n(3 of 3 elements)'

	it('returns the reference of the one row with the role and the name', () => {
		expect(requireOutlineReference(text, 'button', 'Keep')).toBe('e2')
		expect(requireOutlineReference(text, 'link', 'Keep')).toBe('e3')
		expect(
			requireOutlineReference(
				`2 elements match "keep":\ne2 button "Keep"\ne3 link "Keep"\n\n${text}`,
				'button',
				'Keep',
			),
		).toBe('e2')
	})

	it('refuses an absent row and a role and name two rows share', () => {
		expect(() => requireOutlineReference(text, 'button', 'Save')).toThrow(
			'Expected one outline row button "Save" and found 0',
		)
		expect(() => requireOutlineReference(`${text}\ne4 button "Keep"`, 'button', 'Keep')).toThrow(
			'Expected one outline row button "Keep" and found 2',
		)
	})
})

describe('requireToolText', () => {
	it('returns the text of a successful tool result from the manager and from its JSON copy', async () => {
		const tools = createToolManager()
		tools.add(createTool({ name: 'echo', execute: (args) => String(args['text']) }))
		const result = await tools.execute({ id: '1', name: 'echo', arguments: { text: 'ready' } })

		expect(requireToolText(result)).toBe('ready')
		expect(requireToolText(JSON.parse(JSON.stringify(result)))).toBe('ready')
	})

	it('throws the failure a result reports and refuses a result with no string value', async () => {
		const tools = createToolManager()
		tools.add(createTool({ name: 'count', execute: () => 7 }))

		expect(() =>
			requireToolText({ id: '1', name: 'look', success: false, error: 'A dialog is open' }),
		).toThrow('The tool call failed: A dialog is open')
		await expect(
			tools.execute({ id: '2', name: 'missing', arguments: {} }).then(requireToolText),
		).rejects.toThrow('The tool call failed: ')
		await expect(
			tools.execute({ id: '3', name: 'count', arguments: {} }).then(requireToolText),
		).rejects.toThrow('The tool call returned no text')
		expect(() => requireToolText(undefined)).toThrow('The tool call returned no text')
	})
})

describe('matchesToolReceipt', () => {
	const view =
		'page "Drafts" http://127.0.0.1/confirm\n# Drafts\ne2 button "Keep"\n(1 of 1 elements)'
	const kept = { action: 'Clicked e2 button "Keep"', view }
	const placed = {
		action: 'Clicked e1 link "Next"',
		view: 'page "Next note" http://127.0.0.1/next\n# Next note\n(0 of 0 elements)',
		url: 'http://127.0.0.1/next',
	}

	it('accepts the captured view, the deadline note, and for a navigation the still-loading status', () => {
		expect(matchesToolReceipt(`Clicked e2 button "Keep".\n\n${view}`, kept)).toBe(true)
		expect(
			matchesToolReceipt(`Clicked e2 button "Keep".\n\n${BROWSER_TOOL_DEADLINE_NOTE}`, kept),
		).toBe(true)
		expect(
			matchesToolReceipt(
				`Clicked e1 link "Next"; the page is still loading http://127.0.0.1/next.\n\n${placed.view}`,
				placed,
			),
		).toBe(true)
		expect(matchesToolReceipt(`Clicked e1 link "Next".\n\n${placed.view}`, placed)).toBe(true)
		expect(matchesToolReceipt(`Clicked e1 link "Next".\n\n${SERVICE_CHANGED_NOTE}`, placed)).toBe(
			true,
		)
		expect(SERVICE_CHANGED_NOTE).toBe(
			'(The page changed before the view could be read; call look.)',
		)
	})

	it('accepts after a still-loading status only the destination view, the changed note, or the deadline note', () => {
		const loading = 'Clicked e1 link "Next"; the page is still loading http://127.0.0.1/next.\n\n'
		expect(
			[placed.view, SERVICE_CHANGED_NOTE, BROWSER_TOOL_DEADLINE_NOTE].map((suffix) =>
				matchesToolReceipt(`${loading}${suffix}`, placed),
			),
		).toEqual([true, true, true])
		expect(
			[
				'',
				'the page',
				'page "" http://127.0.0.1/next\n(0 of 0 elements)',
				view,
				'(The view could not be read: gone; call look.)',
				`${SERVICE_CHANGED_NOTE}\nextra`,
			].map((suffix) => matchesToolReceipt(`${loading}${suffix}`, placed)),
		).toEqual([false, false, false, false, false, false])
	})

	it('refuses another view, another action, a capture error, a loading status without a navigation, and another URL', () => {
		expect(matchesToolReceipt(`Clicked e2 button "Keep".\n\n${view}\nextra`, kept)).toBe(false)
		expect(matchesToolReceipt(`Clicked e3 button "Keep".\n\n${view}`, kept)).toBe(false)
		expect(
			matchesToolReceipt(
				'Clicked e2 button "Keep".\n\n(The view could not be read: gone; call look.)',
				kept,
			),
		).toBe(false)
		expect(matchesToolReceipt(`Clicked e2 button "Keep".\n\n${SERVICE_CHANGED_NOTE}`, kept)).toBe(
			false,
		)
		expect(
			matchesToolReceipt(
				`Clicked e2 button "Keep"; the page is still loading http://127.0.0.1/confirm.\n\n${view}`,
				kept,
			),
		).toBe(false)
		expect(
			matchesToolReceipt(
				'Clicked e1 link "Next"; the page is still loading http://127.0.0.1/other.\n\n',
				placed,
			),
		).toBe(false)
		expect(
			matchesToolReceipt(
				'Clicked e1 link "Next"; it requested http://127.0.0.1/next and the page did not change.\n\n',
				placed,
			),
		).toBe(false)
	})
})

describe('requireDocumentToolset', () => {
	it('resolves after the page reports its toolset ready', async () => {
		const read: string[] = []
		const page = {
			evaluate: (expression: string): Promise<unknown> => {
				read.push(expression)
				if (expression === 'document.body.dataset.failed') return Promise.resolve(undefined)
				return Promise.resolve(read.length < 3 ? undefined : 'yes')
			},
		}

		await expect(requireDocumentToolset(page, 1_000)).resolves.toBeUndefined()
		expect(read).toStrictEqual([
			'document.body.dataset.ready ?? document.body.dataset.failed',
			'document.body.dataset.ready ?? document.body.dataset.failed',
			'document.body.dataset.ready ?? document.body.dataset.failed',
			'document.body.dataset.failed',
		])
	})

	it('throws the error the page recorded, and names the import when the page reports nothing', async () => {
		const failed = {
			evaluate: (): Promise<unknown> => Promise.resolve('TypeError: Failed to fetch'),
		}
		const silent = { evaluate: (): Promise<unknown> => Promise.resolve(undefined) }

		await expect(requireDocumentToolset(failed, 1_000)).rejects.toThrow(
			'Precondition failed: the document toolset did not start: TypeError: Failed to fetch',
		)
		await expect(requireDocumentToolset(silent, 50)).rejects.toThrow(
			'precondition: the document page imported dist/src/browser and started its toolset',
		)
	})
})

describe('SERVICE_REGISTRY_ARGS', () => {
	it('carries the feature switch that exposes the WebMCP domain as a frozen list', () => {
		expect([...SERVICE_REGISTRY_ARGS]).toStrictEqual(['--enable-features=WebMCP'])
		expect(Object.isFrozen(SERVICE_REGISTRY_ARGS)).toBe(true)
	})
})

describe('scanServiceSkips', () => {
	const reasons = ['REGISTRY_ABSENT_REASON']

	it('accepts a conditional context skip on an identifier, a member path, or a call citing a listed reason', () => {
		expect(
			scanServiceSkips(
				[
					'context.skip(!started, REGISTRY_ABSENT_REASON)',
					'context.skip( !registry.started , REGISTRY_ABSENT_REASON )',
					"context.skip(!domains.includes('WebMCP'), REGISTRY_ABSENT_REASON)",
				].join('\n'),
				reasons,
			),
		).toStrictEqual([])
		expect(scanServiceSkips("it('runs', async () => undefined)", reasons)).toStrictEqual([])
	})

	it('reports chained and declared skips on every receiver', () => {
		expect(
			scanServiceSkips(
				[
					"it.skip.each([1])('case', () => undefined)",
					"describe.skip('block', () => undefined)",
					"test.skip('case', () => undefined)",
					"it.skipIf(absent)('case', () => undefined)",
					"it.runIf(present)('case', () => undefined)",
					"it.concurrent.skip('case', () => undefined)",
				].join('\n'),
				reasons,
			),
		).toStrictEqual([
			"it.skip.each([1])('case', () => undefined)",
			"describe.skip('block', () => undefined)",
			"test.skip('case', () => undefined)",
			"it.skipIf(absent)('case', () => undefined)",
			"it.runIf(present)('case', () => undefined)",
			"concurrent.skip('case', () => undefined)",
		])
	})

	it('reports a context skip whose condition is a literal or missing, or whose reason is not listed', () => {
		expect(
			scanServiceSkips(
				[
					'context.skip(!false, REGISTRY_ABSENT_REASON)',
					'context.skip(!true, REGISTRY_ABSENT_REASON)',
					'context.skip(REGISTRY_ABSENT_REASON)',
					'context.skip(started, REGISTRY_ABSENT_REASON)',
					"context.skip(!started, 'registry absent')",
					'context.skip(!started, OTHER_REASON)',
					'context.skip(!started, REGISTRY_ABSENT_REASON, extra)',
					'context.skip()',
					'const skip = context.skip',
				].join('\n'),
				reasons,
			),
		).toStrictEqual([
			'context.skip(!false, REGISTRY_ABSENT_REASON)',
			'context.skip(!true, REGISTRY_ABSENT_REASON)',
			'context.skip(REGISTRY_ABSENT_REASON)',
			'context.skip(started, REGISTRY_ABSENT_REASON)',
			"context.skip(!started, 'registry absent')",
			'context.skip(!started, OTHER_REASON)',
			'context.skip(!started, REGISTRY_ABSENT_REASON, extra)',
			'context.skip()',
			'context.skip',
		])
	})
})

describe('requireCacheRestore', () => {
	it('accepts a recorded back-forward cache restore with no reported miss', () => {
		expect(
			requireCacheRestore(
				[
					{ frame: { id: 'main' }, type: 'Navigation' },
					{ frame: { id: 'main' }, type: 'BackForwardCacheRestore' },
				],
				[],
			),
		).toBeUndefined()
	})

	it('names every reported miss reason and the remedy, even beside a restore', () => {
		expect(() =>
			requireCacheRestore(
				[{ type: 'BackForwardCacheRestore' }],
				[
					{
						notRestoredExplanations: [
							{ type: 'Circumstantial', reason: 'CacheLimit' },
							{ type: 'Circumstantial', reason: 'TimeoutPuttingInCache' },
						],
					},
					{ loaderId: 'L1' },
				],
			),
		).toThrow(
			'Precondition failed: the host did not restore the page from the back-forward cache (CacheLimit, TimeoutPuttingInCache, unnamed); run the service project with fewer concurrent browsers.',
		)
	})

	it('refuses a navigation that was neither restored nor reported missed', () => {
		expect(() => requireCacheRestore([{ type: 'Navigation' }], [])).toThrow(
			'Precondition failed: the history navigation committed without a back-forward cache restore and without a reported cache miss.',
		)
		expect(() => requireCacheRestore([], [])).toThrow('without a back-forward cache restore')
	})
})

describe('tests/service readiness', () => {
	it('resolves its browser through requireSystemBrowser in every service proof and skips only with a reason this module cites', () => {
		const proofs = readdirSync(SERVICE_DIRECTORY).filter((name) => name.endsWith('.test.ts'))
		const reasons = Object.entries(setupService)
			.filter(([name, value]) => name.endsWith('_REASON') && isString(value))
			.map(([name]) => name)

		expect(proofs.length).toBeGreaterThan(0)
		expect(reasons).toContain('REGISTRY_ABSENT_REASON')
		for (const proof of proofs) {
			const source = readFileSync(join(SERVICE_DIRECTORY, proof), 'utf8')
			expect(source).toContain('requireSystemBrowser(')
			expect(scanServiceSkips(source, reasons)).toStrictEqual([])
		}
	})
})
