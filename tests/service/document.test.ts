/**
 * Live-browser proofs for the DOM placement served from the built `dist/src/browser` bundle.
 *
 * The fixture server's `/document` page imports the bundle through an import map, installs the
 * WebMCP registry double, and publishes `createDocumentToolset({ document, own: true, source })`
 * over its own document on `window.documentToolset`. Each case reads that toolset's results back
 * through `page.evaluate` and compares them with the CDP outline and a CDP toolset over the same
 * page. The bundle is a hard precondition: `requireDocumentBundle` throws naming `npm run build`
 * before a browser launches. The browser is the one `tests/setupService.ts` resolves, launched
 * once for the block; every page a case opens is closed after it.
 *
 * One case is an expected failure: the DOM outline skips a `select` element's subtree, so its
 * `option` rows, which the CDP outline lists under the combobox, are missing from the DOM set.
 */

import type { BrowserInterface } from '@src/server'
import type { BrowserPageInterface, BrowserToolsetInterface } from '@src/core'
import type { FixtureServerInterface } from '../setupServer.js'
import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { createBrowser } from '@src/server'
import { createBrowserToolset } from '@src/core'
import { createToolManager } from '@orkestrel/tool'
import { createTeardown, waitForCondition } from '@orkestrel/test'
import {
	createFixtureServer,
	createTempDirectory,
	requireDocumentBundle,
	reservePort,
} from '../setupServer.js'
import {
	collectOutlinePairs,
	requireOutlineReference,
	requireSystemBrowser,
	requireToolText,
	SERVICE_BROWSER_ARGS,
} from '../setupService.js'

const REAL_BROWSER_EXECUTABLE = requireSystemBrowser().executable

describe('createDocumentToolset served from dist/src/browser against CDP on the same page', () => {
	const teardown = createTeardown()
	const toolsets: BrowserToolsetInterface[] = []
	let fixtures: FixtureServerInterface
	let browser: BrowserInterface
	let page: BrowserPageInterface

	beforeAll(async () => {
		requireDocumentBundle()
		const server = await createFixtureServer()
		teardown.add(() => server.destroy())
		fixtures = server

		const profile = createTempDirectory('orkestrel-browser-profile-')
		teardown.add(() => profile.destroy())
		const launched = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: profile.path,
			args: [...SERVICE_BROWSER_ARGS],
			cdp: { port: await reservePort() },
			timeout: 20_000,
		})
		teardown.add(() => launched.destroy())
		await launched.connect()
		browser = launched
	})

	// A module that fails to load sets neither flag, and the wait names the bundle it depends on.
	beforeEach(async () => {
		page = await browser.create({ url: fixtures.url('/document') })
		await waitForCondition(
			'precondition: the document page imported dist/src/browser and started its toolset',
			async () =>
				(await page.evaluate('document.body.dataset.ready ?? document.body.dataset.failed')) !==
				undefined,
			{ budget: 10_000, interval: 20 },
		)
		const failed = await page.evaluate('document.body.dataset.failed')
		if (failed !== undefined)
			throw new Error(`Precondition failed: the document toolset did not start: ${String(failed)}`)
	})

	afterEach(async () => {
		for (const toolset of toolsets.splice(0)) await toolset.destroy().catch(() => undefined)
		await page.close().catch(() => undefined)
	})

	afterAll(async () => {
		await teardown.destroy()
	})

	it('lists the same interactive (role, name) set in the DOM look as the CDP outline of the same page', async () => {
		const dom = requireToolText(
			await page.evaluate(
				"documentToolset.tools.execute({ id: 'look', name: 'look', arguments: { what: 'the gift options' } })",
			),
		)
		const cdp = (await page.elements.outline()).text

		expect(collectOutlinePairs(cdp)).toStrictEqual([
			'button "Apply"',
			'checkbox "Gift wrap"',
			'link "Delivery desk"',
			'textbox "Message"',
		])
		expect(collectOutlinePairs(dom)).toStrictEqual(collectOutlinePairs(cdp))
	})

	// `BrowserDOMElementManager` skips a `select` element's subtree after its combobox row, so the
	// DOM look carries no `option` row, while the CDP outline lists one per option under it.
	it.fails('lists the option rows of a select in the DOM look as the CDP outline does', async () => {
		await page.evaluate(
			"(() => { const label = document.createElement('label'); label.append('Box ', document.createElement('select')); label.lastChild.append(new Option('Small'), new Option('Large')); document.querySelector('main').append(label); return true })()",
		)
		const dom = requireToolText(
			await page.evaluate(
				"documentToolset.tools.execute({ id: 'look', name: 'look', arguments: { what: 'the gift options' } })",
			),
		)
		const cdp = (await page.elements.outline()).text

		expect(collectOutlinePairs(cdp)).toContain('option "Large"')
		expect(collectOutlinePairs(dom)).toStrictEqual(collectOutlinePairs(cdp))
	})

	it('ends a DOM click receipt with (untrusted event) and records isTrusted false, while a CDP click receipt on the same page carries no marker and records isTrusted true', async () => {
		const look = requireToolText(
			await page.evaluate(
				"documentToolset.tools.execute({ id: 'look', name: 'look', arguments: { what: 'gift wrap' } })",
			),
		)
		const wrap = requireOutlineReference(look, 'checkbox', 'Gift wrap')
		const clicked = requireToolText(
			await page.evaluate(
				`documentToolset.tools.execute({ id: 'click', name: 'click', arguments: { ref: ${JSON.stringify(wrap)} } })`,
			),
		)
		expect(clicked.split('\n', 1)[0]).toBe(
			`Clicked ${wrap} checkbox "Gift wrap". (untrusted event)`,
		)
		expect(await page.evaluate('document.body.dataset.trusted')).toBe('false')
		expect(await page.evaluate("document.getElementById('wrap').checked")).toBe(true)

		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()
		const reference = requireOutlineReference(
			requireToolText(
				await tools.execute({ id: 'look', name: 'look', arguments: { what: 'gift wrap' } }),
			),
			'checkbox',
			'Gift wrap',
		)
		const trusted = requireToolText(
			await tools.execute({ id: 'click', name: 'click', arguments: { ref: reference } }),
		)
		expect(trusted.split('\n', 1)[0]).toBe(`Clicked ${reference} checkbox "Gift wrap".`)
		expect(trusted).not.toContain('(untrusted event)')
		expect(await page.evaluate('document.body.dataset.trusted')).toBe('false true')
		expect(await page.evaluate("document.getElementById('wrap').checked")).toBe(false)
	})

	it('refuses a workspace without the built bundle before any page loads, naming npm run build', () => {
		const empty = createTempDirectory()

		expect(() => requireDocumentBundle(empty.path)).toThrow(
			'dist/src/browser/index.js and dist/src/core/index.js are absent; run npm run build',
		)
		expect(requireDocumentBundle()).toBeUndefined()
	})
})
