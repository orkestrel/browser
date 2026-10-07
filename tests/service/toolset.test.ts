import { BROWSER_READING_HTML, BROWSER_READING_STRUCTURE_HTML } from '../setup.js'
import { renderBrowserLine } from '@src/core'
import { writeFileSync } from 'node:fs'
import { SERVICE_READING_SUBMISSIONS, SERVICE_STORE_PARAGRAPHS } from '../setupService.js'
import { BROWSER_SUBMIT_KEY } from '@src/core'
/**
 * Live-browser proofs for `BrowserToolset` over a real page, driven through `@orkestrel/tool`.
 *
 * Every toolset here is registered in a `createToolManager()` manager and every call runs through
 * that manager's `execute`, so a receipt is the text a model would read. The browser is the one
 * `tests/setupService.ts` resolves, launched once for the file with `--site-per-process` so the
 * `localhost` frame of the voucher page renders out of process; every page and context a case
 * opens is closed after it, and every toolset destroyed.
 *
 * A receipt that carries a view is accepted in each form a correct toolset returns when a load or
 * the capture outruns the receipt deadline, and the state the action produced is then read
 * independently; the `performance` block asserts the captured view within the deadline.
 *
 * Chromium 141 attaches no page that `window.open` creates to its opener's session; the page
 * adopts it through target discovery, and the click that opened it settles on it.
 */

import type { BrowserInterface } from '@src/server'
import type {
	BrowserAction,
	BrowserContextInterface,
	BrowserPageInterface,
	BrowserToolsetInterface,
	CDPClientInterface,
} from '@src/core'
import type { ToolManagerInterface } from '@orkestrel/tool'
import type { FixtureServerInterface } from '../setupServer.js'
import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { createBrowser, createCDPTransport } from '@src/server'
import {
	BROWSER_TOOL_LIMIT,
	BROWSER_TOOL_TIMEOUT_MS,
	createBrowserToolset,
	createCDPClient,
} from '@src/core'
import { isArray, isRecord, isString } from '@orkestrel/contract'
import { createToolManager } from '@orkestrel/tool'
import {
	createRecorder,
	createTeardown,
	requireValue,
	retryUntil,
	waitForCondition,
} from '@orkestrel/test'
import {
	createFixtureServer,
	requireDocumentBundle,
	createTempDirectory,
	FIXTURE_CHECKOUT_CODE,
	reservePort,
} from '../setupServer.js'
import {
	extractOutlineRows,
	collectOutlineEntries,
	matchesToolReceipt,
	requireOutlineReference,
	requireSystemBrowser,
	requireDocumentToolset,
	maskBrowserReferences,
	requireToolText,
	SERVICE_BROWSER_ARGS,
	SERVICE_EDITABLE_HTML,
	SERVICE_TRACKING_HTML,
	SERVICE_TOGGLE_HTML,
} from '../setupService.js'
import {
	BROWSER_JOURNEY_SERVICE_CASES,
	BROWSER_JOURNEY_COMBOBOX_HTML,
	BROWSER_JOURNEY_FRAME_HTML,
	BROWSER_JOURNEY_POPUP_LINK_HTML,
	extractBrowserPage,
	requireBrowserJourneyElement,
} from '../setup.js'

const REAL_BROWSER_EXECUTABLE = requireSystemBrowser().executable

describe('BrowserToolset over a real page through createToolManager().execute', () => {
	const teardown = createTeardown()
	const opened: BrowserPageInterface[] = []
	const contexts: BrowserContextInterface[] = []
	const toolsets: BrowserToolsetInterface[] = []
	let fixtures: FixtureServerInterface
	let browser: BrowserInterface
	let port: number

	// Each resource registers its release as soon as it exists, so a later acquisition that
	// rejects still releases the earlier ones.
	beforeAll(async () => {
		const server = await createFixtureServer()
		teardown.add(() => server.destroy())
		fixtures = server

		const profile = createTempDirectory('orkestrel-browser-profile-')
		teardown.add(() => profile.destroy())
		port = await reservePort()
		const launched = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: profile.path,
			args: [...SERVICE_BROWSER_ARGS, '--site-per-process'],
			cdp: { port },
			timeout: 20_000,
		})
		teardown.add(() => launched.destroy())
		await launched.connect()
		browser = launched
	})

	afterEach(async () => {
		for (const toolset of toolsets.splice(0)) await toolset.destroy().catch(() => undefined)
		for (const page of opened.splice(0)) await page.close().catch(() => undefined)
		for (const context of contexts.splice(0)) await context.close().catch(() => undefined)
	})

	afterAll(async () => {
		await teardown.destroy()
	})

	describe('journey perform equality', () => {
		it('matches the direct editable-combobox receipt and its filled value', async () => {
			const receipts: string[] = []
			for (const direct of [true, false]) {
				const page = await browser.create({ url: fixtures.url('/form') })
				opened.push(page)
				await page.evaluate(
					`document.querySelector('main').innerHTML = ${JSON.stringify(BROWSER_JOURNEY_COMBOBOX_HTML)}`,
				)
				const toolset = createBrowserToolset(page)
				toolsets.push(toolset)
				await toolset.start()
				const target = { role: 'combobox', name: 'Destination' }
				if (direct) {
					const element = await requireBrowserJourneyElement(page, target)
					receipts.push(
						requireToolText(
							await toolset.tools.execute({
								id: 's1',
								name: 'type',
								arguments: { ref: element.reference, text: 'Harbor' },
							}),
						).split('\n\n')[0] ?? '',
					)
				} else
					receipts.push(
						(
							await toolset.follow('s1', {
								action: 'type',
								target,
								arguments: { text: 'Harbor' },
							})
						).receipt,
					)
				expect(await page.evaluate('document.querySelector("input").value')).toBe('Harbor')
			}
			expect(maskBrowserReferences(receipts[1] ?? '')).toBe(
				maskBrowserReferences(receipts[0] ?? ''),
			)
		})

		it('performs a semantic click in a same-origin child frame through the DOM placement', async () => {
			requireDocumentBundle()
			const page = await browser.create({ url: fixtures.url('/document') })
			opened.push(page)
			await requireDocumentToolset(page)
			await page.evaluate(
				`new Promise((resolve) => { const frame = document.createElement('iframe'); frame.onload = resolve; frame.srcdoc = ${JSON.stringify(BROWSER_JOURNEY_FRAME_HTML)}; document.body.append(frame) })`,
			)
			const action = await page.evaluate(
				`documentToolset.follow('s1', { action: 'click', arguments: {}, target: { role: 'button', name: 'Save in frame' } })`,
			)
			expect(action).toMatchObject({
				outcome: 'done',
				target: { role: 'button', name: 'Save in frame' },
			})
			expect(
				await page.evaluate(
					'document.querySelector("iframe").contentDocument.body.dataset.clicked',
				),
			).toBe('yes')
		})
		it.each(BROWSER_JOURNEY_SERVICE_CASES)(
			'matches the direct receipt, stage, and reason for $name',
			async (scenario) => {
				const observed: BrowserAction[] = []
				const receipts: string[] = []
				for (const direct of [true, false]) {
					const page = await browser.create({ url: fixtures.url(scenario.route) })
					opened.push(page)
					const toolset = createBrowserToolset(page)
					toolsets.push(toolset)
					await toolset.start()
					await page.elements.outline()
					const args =
						scenario.action === 'navigate'
							? { url: fixtures.url(scenario.arguments.url) }
							: scenario.arguments
					const target =
						'target' in scenario
							? await requireBrowserJourneyElement(page, scenario.target)
							: undefined
					const call = {
						id: 's1',
						name: scenario.action,
						arguments: target === undefined ? args : { ...args, ref: target.reference },
					}
					if (direct) {
						toolset.emitter.on('action', (action) => observed.push(action))
						receipts.push(requireToolText(await toolset.tools.execute(call)))
					} else {
						const performed = await toolset.perform(call)
						observed.push(requireValue(performed.action))
						receipts.push(requireToolText(performed.result))
					}
				}
				expect(maskBrowserReferences(receipts[1] ?? '')).toBe(
					maskBrowserReferences(receipts[0] ?? ''),
				)
				expect(observed[1]?.stage).toBe(observed[0]?.stage)
				expect(observed[1]?.reason).toBe(observed[0]?.reason)
				expect(observed.map((action) => action.outcome)).toEqual(['done', 'done'])
			},
		)

		it('matches the interrupted click and its dialog continuation without waiting for the blocked input', async () => {
			const observed: BrowserAction[][] = []
			for (const direct of [true, false]) {
				const page = await browser.create({ url: fixtures.url('/confirm') })
				opened.push(page)
				const toolset = createBrowserToolset(page)
				toolsets.push(toolset)
				await toolset.start()
				const target = await requireBrowserJourneyElement(page, { role: 'button', name: 'Delete' })
				const actions: BrowserAction[] = []
				toolset.emitter.on('action', (action) => actions.push(action))
				const call = { id: 's1', name: 'click', arguments: { ref: target.reference } }
				if (direct) await toolset.tools.execute(call)
				else await toolset.perform(call)
				expect(actions[0]?.outcome).toBe('interrupted')
				if (direct)
					await toolset.tools.execute({ id: 's2', name: 'dialog', arguments: { accept: true } })
				else await toolset.follow('s2', { action: 'dialog', arguments: { accept: true } })
				await toolset.follow('s3', { action: 'press', arguments: { key: 'Escape' } })
				expect(actions.map((action) => action.outcome)).toEqual(['interrupted', 'done', 'done'])
				observed.push(actions)
			}
			expect(
				observed[1]?.map((action) => [
					maskBrowserReferences(action.receipt),
					action.stage,
					action.reason,
				]),
			).toEqual(
				observed[0]?.map((action) => [
					maskBrowserReferences(action.receipt),
					action.stage,
					action.reason,
				]),
			)
		})

		it('resolves a switch by URL and title and matches the direct tab receipt', async () => {
			const actions: BrowserAction[] = []
			for (const direct of [true, false]) {
				const context = await browser.isolate()
				contexts.push(context)
				const first = await context.create({ url: fixtures.url('/popup') })
				await context.create({ url: fixtures.url('/popup/child') })
				const toolset = createBrowserToolset(first, { context })
				toolsets.push(toolset)
				await toolset.start()
				toolset.emitter.on('action', (action) => actions.push(action))
				if (direct)
					await toolset.tools.execute({ id: 's1', name: 'switch', arguments: { tab: 't2' } })
				else
					await toolset.follow('s1', {
						action: 'switch',
						arguments: {},
						tab: { title: 'Details', url: fixtures.url('/popup/child') },
					})
			}
			expect(actions[1]?.receipt).toBe(actions[0]?.receipt)
			expect(actions[1]?.arguments).toEqual({ tab: 't2' })
			expect(actions[1]?.tab).toEqual({ title: 'Details', url: fixtures.url('/popup/child') })
		})

		it('matches the direct receipt of a click on a link that opens a popup, each settling on the popup with the move in its result', async () => {
			const child = fixtures.url('/popup/child')
			const results: string[] = []
			const actions: BrowserAction[] = []
			for (const direct of [true, false]) {
				const context = await browser.isolate()
				contexts.push(context)
				const page = await context.create({ url: fixtures.url('/popup') })
				await page.evaluate(
					`document.querySelector('main').innerHTML = ${JSON.stringify(BROWSER_JOURNEY_POPUP_LINK_HTML)}`,
				)
				const toolset = createBrowserToolset(page, { context })
				toolsets.push(toolset)
				await toolset.start()
				const target = await requireBrowserJourneyElement(page, {
					role: 'link',
					name: 'Open details',
				})
				const call = { id: 's1', name: 'click', arguments: { ref: target.reference } }
				if (direct) {
					toolset.emitter.on('action', (action) => actions.push(action))
					results.push(requireToolText(await toolset.tools.execute(call)))
				} else {
					const performed = await toolset.perform(call)
					actions.push(requireValue(performed.action))
					results.push(requireToolText(performed.result))
				}
				expect(toolset.view).not.toBe(page)
				expect(toolset.view.url).toBe(child)
				expect(context.pages()).toContain(toolset.view)
			}
			const [first, second] = results.map((result) => maskBrowserReferences(result))
			expect(second).toBe(first)
			expect(first).toContain(`The view moved to a new tab: ${child}.`)
			expect(first).toContain(`Clicked e# link "Open details".\n\npage "Details" ${child}`)
			expect(actions.map((action) => [action.outcome, action.tab])).toEqual([
				['done', { url: child, title: 'Details' }],
				['done', { url: child, title: 'Details' }],
			])
		})
	})

	it('audit repair 14: measures an outline capture of 5000 paragraph nodes', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		await page.evaluate(`document.body.innerHTML = '<p>Ordinary capture material</p>'.repeat(5000)`)
		const elapsed: number[] = []
		for (let sample = 0; sample < 3; sample += 1) {
			const started = performance.now()
			const outline = await page.elements.outline({ timeout: 30000 })
			elapsed.push(performance.now() - started)
			expect(outline.lines).toHaveLength(5000)
		}
		writeFileSync(
			'tmp/codex/reading-capture-cost.json',
			JSON.stringify({ paragraphs: 5000, elapsed }),
		)
	})
	it('audit repair 1: the receipt and error redaction layer protects unnumbered text', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		const secret = 'private-receipt-4821'
		await page.evaluate(
			`document.body.innerHTML = '<input aria-label="Code"><button>Save</button>'`,
		)
		const toolset = createBrowserToolset(page)
		toolsets.push(toolset)
		await toolset.start()
		const field = requireValue((await page.elements.find({ role: 'textbox', name: 'Code' }))[0])
		await toolset.tools.execute({
			id: 'secret',
			name: 'type',
			arguments: { ref: field.reference, text: secret, secret: true },
		})
		await page.evaluate(`document.querySelector('button').textContent = ${JSON.stringify(secret)}`)
		const button = requireValue((await page.elements.find({ role: 'button', name: secret }))[0])
		const receipt = requireToolText(
			await toolset.tools.execute({
				id: 'click',
				name: 'click',
				arguments: { ref: button.reference },
			}),
		)
		expect(receipt).not.toContain(secret)
		expect(receipt.split('\n')[0]).toContain('[redacted]')
		const refused = await toolset.tools.execute({
			id: 'bad',
			name: 'read',
			arguments: { from: 1, [secret]: true },
		})
		expect(refused.success ? '' : refused.error).not.toContain(secret)
	})
	it('audit repair 1: a numeric secret preserves addressed rows and continuation', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		await page.evaluate(
			`document.body.innerHTML = '<input aria-label="Code">' + '<p>Ordinary prose</p>'.repeat(110)`,
		)
		const toolset = createBrowserToolset(page)
		toolsets.push(toolset)
		await toolset.start()
		const field = requireValue((await page.elements.find({ role: 'textbox', name: 'Code' }))[0])
		const receipt = requireToolText(
			await toolset.tools.execute({
				id: 'secret',
				name: 'type',
				arguments: { ref: field.reference, text: '100', secret: true },
			}),
		)
		expect(receipt).toContain('100: Ordinary prose')
		expect(receipt).toContain('[lines 1–100 of 111; 11 below; call read with from 101 for more]')
		for (const result of [
			await toolset.read({ from: 100 }),
			requireToolText(
				await toolset.tools.execute({ id: 'read', name: 'read', arguments: { from: 100 } }),
			),
		]) {
			expect(result).toContain('\n100: Ordinary prose')
			expect(result).toContain('[lines 100–111 of 111; 99 above; end of page]')
			expect(result.length).toBeLessThanOrEqual(4000)
		}
	})
	it.each([' Tide4821', 'Tide4821 ', 'Tide  4821', 'Tide\n4821'])(
		'audit repair 1: whitespace secret %j never reaches a receipt or window',
		async (secret) => {
			const page = await browser.create({ url: fixtures.url('/form') })
			opened.push(page)
			await page.evaluate(`document.body.innerHTML = '<textarea aria-label="Code"></textarea>'`)
			const toolset = createBrowserToolset(page)
			toolsets.push(toolset)
			await toolset.start()
			const field = requireValue((await page.elements.find({ role: 'textbox', name: 'Code' }))[0])
			const receipt = requireToolText(
				await toolset.tools.execute({
					id: 'secret',
					name: 'type',
					arguments: { ref: field.reference, text: secret, secret: true },
				}),
			)
			for (const result of [receipt, await toolset.read()]) {
				expect(result).not.toContain('Tide')
				expect(result).toContain('[redacted]')
			}
			expect(await page.evaluate('document.querySelector("textarea").value')).toBe(secret)
		},
	)
	it('audit repair 3: refused captures preserve the last delivered projection and pending move note', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		await page.evaluate(`document.body.innerHTML = '<p>Original</p>'.repeat(110)`)
		let note = ''
		const toolset = createBrowserToolset(page, {
			notes: () => {
				const result = note
				note = ''
				return result
			},
		})
		toolsets.push(toolset)
		await toolset.start()
		await toolset.read()
		await page.evaluate(`document.body.innerHTML = '<p>Replacement</p>'.repeat(40)`)
		note = 'The view moved to a new tab.'
		await expect(toolset.read({ from: 101 })).rejects.toThrow('past the end')
		const result = await toolset.read({ from: 20 })
		expect(result).toContain('The page changed since the last view')
		expect(result).toContain('The view moved to a new tab.')
		expect(await toolset.read({ from: 20 })).not.toContain('The view moved to a new tab.')
	})
	it('audit repair 6: wait opens at text spanning wrapped lines and quoted names', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		await page.evaluate(
			`document.body.innerHTML = '<p>Earlier</p>'.repeat(30) + '<p>' + 'filler '.repeat(113) + 'Order A12 placed</p><button>Say &quot;yes&quot;</button>'`,
		)
		const toolset = createBrowserToolset(page)
		toolsets.push(toolset)
		await toolset.start()
		const result = requireToolText(
			await toolset.tools.execute({
				id: 'wait',
				name: 'wait',
				arguments: { text: 'Order A12 placed' },
			}),
		)
		expect(result).toContain('\n31: ')
		expect(result).not.toContain('\n1: ')
		const quoted = requireToolText(
			await toolset.tools.execute({ id: 'quoted', name: 'wait', arguments: { text: 'Say "yes"' } }),
		)
		expect(quoted).toMatch(/\n33: e\d+ button/)
		expect(quoted).not.toContain('\n1: ')
	})
	it('reading campaign: projects controls, redacts typed secrets in the receipt and the following window', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		await page.evaluate(`document.body.innerHTML = ${JSON.stringify(BROWSER_READING_HTML)}`)
		const toolset = createBrowserToolset(page)
		toolsets.push(toolset)
		await toolset.start()
		const first = await toolset.read()
		expect(first).toMatch(/1: ### e\d+ link "Cedar Tea" \/tea\?q=1#cup/)
		expect(first).toContain('- A list entry')
		expect(first).toContain('Product | Price')
		expect(first).toContain('Cedar | 41')
		expect(first).toContain('image "Named image"')
		expect(first).not.toContain('sample')
		expect(first.match(/value="••••••"/g)).toHaveLength(2)
		expect(first).not.toMatch(/\d+: ••••••/)
		const fields = await page.elements.find({ role: 'textbox', name: 'Account' })
		const secret = 'rosewood-private-47291'
		const receipt = requireToolText(
			await toolset.tools.execute({
				id: 'secret',
				name: 'type',
				arguments: { ref: requireValue(fields[1]).reference, text: secret, secret: true },
			}),
		)
		expect(receipt).not.toContain(secret)
		expect(receipt).toContain('[redacted]')
		expect(await toolset.read()).not.toContain(secret)
		expect(await page.evaluate('document.querySelector("input[type=text]").value')).toBe(secret)
	})

	it('reading campaign: keeps distinct heading links, table references, escaped images and clamped levels', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		await page.evaluate(
			`document.body.innerHTML = ${JSON.stringify(BROWSER_READING_STRUCTURE_HTML)}`,
		)
		writeFileSync(
			'tmp/codex/reading-structure-source.json',
			JSON.stringify(await page.accessibility.snapshot(), null, 2),
		)
		const lines = (await page.elements.outline()).lines
			.map(renderBrowserLine)
			.map(maskBrowserReferences)
		expect(lines).toEqual([
			'## Menu Tea Elsewhere',
			'e# link "Tea" /tea',
			'e# link "Elsewhere" https://else.example/',
			'###### End',
			'Before e# link "Buy" /buy after | 9',
			'image "A \\"quote\\""',
		])
	})

	it('reading campaign: returns complete bounded numbered windows, continuation, search, and a changed continuation', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		await page.evaluate(
			`(() => { document.title = 'Reading fixture'; document.body.innerHTML = ${JSON.stringify(BROWSER_READING_HTML + Array.from({ length: 140 }, (_, index) => `<p>Paragraph ${index + 1}. ${'Ordinary store description. '.repeat(8)}${index === 110 ? 'Delivery schedules tomorrow.' : ''}</p>`).join(''))} })()`,
		)
		const toolset = createBrowserToolset(page)
		toolsets.push(toolset)
		await toolset.start()
		const first = await toolset.read()
		const from = Number(requireValue(/call read with from (\d+) for more/.exec(first))[1])
		const continuation = await toolset.read({ from })
		const search = await toolset.read({ from: 1, search: 'deliver schedule' })
		writeFileSync(
			'tmp/codex/reading-examples.json',
			JSON.stringify({ first, continuation, search }, null, 2),
		)
		for (const result of [first, continuation, search]) {
			expect(result.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
			expect(result).toMatch(/\[lines \d+–\d+ of \d+;/)
			expect(result.match(/^\d+: /gm)?.length).toBeLessThanOrEqual(100)
		}
		expect(continuation).toContain(`\n${from}: `)
		expect(search).toContain('1 line matches "deliver schedule"')
		expect(search).toContain('Delivery schedules tomorrow.')
		expect(await toolset.read({ from: 1, to: 1 })).toMatch(/\[lines 1–1 of/)
		await page.evaluate('document.querySelector("p").textContent = "Changed paragraph"')
		expect(await toolset.read({ from })).toContain('changed')
		for (const args of [{ from: 0 }, { from: 2, to: 1 }, { from: 1.5 }, { from: 99999 }])
			await expect(toolset.read(args)).rejects.toMatchObject({ code: 'TOOLSET_ARGUMENT' })
		for (const name of ['look', 'plain', 'tabs'])
			expect((await toolset.tools.execute({ id: name, name, arguments: {} })).success).toBe(false)
	})

	it('reading campaign: budgets receipts exactly and opens wait at the matching line', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		await page.evaluate(
			`document.body.innerHTML = ${JSON.stringify('<button>Observe</button>' + Array.from({ length: 150 }, (_, index) => `<p>Row ${index + 1}. ${'Ordinary prose. '.repeat(8)}${index === 120 ? 'Unique confirmation' : ''}</p>`).join(''))}`,
		)
		const toolset = createBrowserToolset(page)
		toolsets.push(toolset)
		await toolset.start()
		const button = requireValue((await page.elements.find({ role: 'button', name: 'Observe' }))[0])
		const receipt = requireToolText(
			await toolset.tools.execute({
				id: 'click',
				name: 'click',
				arguments: { ref: button.reference },
			}),
		)
		const boundary = receipt.indexOf('\n\n')
		expect(receipt.slice(boundary + 2)).toBe(
			await toolset.read({ limit: BROWSER_TOOL_LIMIT - boundary - 2 }),
		)
		expect(receipt.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
		const waited = requireToolText(
			await toolset.tools.execute({
				id: 'wait',
				name: 'wait',
				arguments: { text: 'Unique confirmation' },
			}),
		)
		expect(waited).toContain('\n122: Row 121.')
		expect(waited).not.toMatch(/\n121: /)
		expect(waited.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
		const timeout = requireToolText(
			await toolset.tools.execute({
				id: 'timeout',
				name: 'wait',
				arguments: { text: 'Missing text', timeout: 0.01 },
			}),
		)
		expect(timeout).toContain('\n1: ')
		expect(timeout.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
		await page.evaluate(
			`document.querySelector('button').textContent = ${JSON.stringify('Long name '.repeat(600))}`,
		)
		const long = requireToolText(
			await toolset.tools.execute({
				id: 'long',
				name: 'click',
				arguments: { ref: button.reference },
			}),
		)
		expect(long.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
		expect(long).toMatch(/\[lines 1–\d+ of \d+;.*call read with from \d+ for more\]$/)
	})

	it.each(
		['click', 'type', 'press'].flatMap((action) =>
			['_self', '_parent', '_top'].map((target) => ({ action, target })),
		),
	)(
		'reading campaign: $action settles a real frame form targeting $target exactly once',
		async ({ action, target }) => {
			const page = await browser.create({ url: fixtures.url('/form') })
			opened.push(page)
			const form = `<form action="${fixtures.url('/shop/cart')}" target="${target}"><label>Name<input name="name"></label><button>Submit</button></form><script>document.querySelector('form').onsubmit = () => sessionStorage.setItem('submissions', String(Number(sessionStorage.getItem('submissions') ?? 0) + 1))</script>`
			await page.evaluate(
				`(() => { document.body.innerHTML = '<h1>Outer page</h1>'; const frame=document.createElement('iframe'); frame.srcdoc=${JSON.stringify(form)}; document.body.append(frame) })()`,
			)
			const toolset = createBrowserToolset(page)
			toolsets.push(toolset)
			await toolset.start()
			const field = requireValue((await page.elements.wait({ role: 'textbox', name: 'Name' }))[0])
			const button = requireValue((await page.elements.find({ role: 'button', name: 'Submit' }))[0])
			await field.click()
			const args =
				action === 'click'
					? { ref: button.reference }
					: action === 'type'
						? { ref: field.reference, text: 'Ada', submit: true }
						: { key: 'Enter' }
			const receipt = requireToolText(
				await toolset.tools.execute({ id: 'submit', name: action, arguments: args }),
			)
			expect(receipt).toContain('Your cart holds')
			expect(receipt).not.toContain('handled the submission')
			expect(receipt.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
			expect(await page.evaluate('sessionStorage.getItem("submissions")')).toBe('1')
			for (const frame of await page.frames())
				expect(
					await frame.evaluate(`globalThis[${JSON.stringify(BROWSER_SUBMIT_KEY)}] === undefined`),
				).toBe(true)
		},
	)

	it.each(['type', 'press'])(
		'reading campaign: %s reports an Enter without a form and releases its observer',
		async (action) => {
			const page = await browser.create({ url: fixtures.url('/form') })
			opened.push(page)
			await page.evaluate('document.body.innerHTML = "<label>Loose<input></label>"')
			const toolset = createBrowserToolset(page)
			toolsets.push(toolset)
			await toolset.start()
			const field = requireValue((await page.elements.find({ role: 'textbox', name: 'Loose' }))[0])
			await field.click()
			const receipt = requireToolText(
				await toolset.tools.execute({
					id: 'enter',
					name: action,
					arguments:
						action === 'type'
							? { ref: field.reference, text: 'Ada', submit: true }
							: { key: 'Enter' },
				}),
			)
			expect(receipt.includes('no form received the submission')).toBe(action === 'type')
			expect(
				await requireValue((await page.frames())[0]).evaluate(
					`globalThis[${JSON.stringify(BROWSER_SUBMIT_KEY)}] === undefined`,
				),
			).toBe(true)
		},
	)

	it('reading campaign: keeps ordinary ollama store paragraphs whole and reconstructs every continued line', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		await page.evaluate(
			`(() => { document.body.replaceChildren(); for(const text of ${JSON.stringify(SERVICE_STORE_PARAGRAPHS)}) { const p=document.createElement('p'); p.textContent=text; document.body.append(p) } })()`,
		)
		const outline = await page.elements.outline()
		expect(outline.lines.map(renderBrowserLine)).toEqual(SERVICE_STORE_PARAGRAPHS)
		const toolset = createBrowserToolset(page)
		toolsets.push(toolset)
		await toolset.start()
		const reconstructed: string[] = []
		let from = 1
		for (;;) {
			const result = await toolset.read({ from })
			expect(result.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
			const rows = result.split('\n').filter((line) => /^\d+: /.test(line))
			expect(rows[0]).toMatch(new RegExp('^' + from + ': '))
			reconstructed.push(...rows.map((line) => line.replace(/^\d+: /, '')))
			const next = /call read with from (\d+) for more/.exec(result)?.[1]
			if (next === undefined) break
			expect(Number(next)).toBe(from + rows.length)
			from = Number(next)
		}
		expect(reconstructed).toEqual(SERVICE_STORE_PARAGRAPHS)
	})

	it.each(SERVICE_READING_SUBMISSIONS)(
		'reading campaign: settles $name handled submission and releases the observer',
		async ({ code, changed }) => {
			const page = await browser.create({ url: fixtures.url('/form') })
			opened.push(page)
			await page.evaluate(
				`(() => { document.body.innerHTML = '<form><label>Name<input></label><button>Submit</button></form><output></output><aside hidden></aside>'; document.querySelector('form').onsubmit = event => { event.preventDefault(); ${code} } })()`,
			)
			const toolset = createBrowserToolset(page)
			toolsets.push(toolset)
			await toolset.start()
			const button = requireValue((await page.elements.find({ role: 'button', name: 'Submit' }))[0])
			const receipt = requireToolText(
				await toolset.tools.execute({
					id: 'submit',
					name: 'click',
					arguments: { ref: button.reference },
				}),
			)
			expect(receipt.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
			expect(receipt).toContain(
				changed
					? 'the page handled the submission and changed'
					: 'the page handled the submission and has not changed yet; do not submit again; call read or wait for the text you expect',
			)
			expect(receipt.includes('Order confirmed')).toBe(changed)
			expect(
				await requireValue((await page.frames())[0]).evaluate(
					`globalThis[${JSON.stringify(BROWSER_SUBMIT_KEY)}] === undefined`,
				),
			).toBe(true)
		},
	)

	it.each(['click', 'type', 'press'])(
		'reading campaign: %s observes the handled submission before synchronous handlers',
		async (action) => {
			const page = await browser.create({ url: fixtures.url('/form') })
			opened.push(page)
			await page.evaluate(
				`(() => { document.body.innerHTML = '<form><label>Name<input></label><button>Submit</button></form><output></output>'; document.querySelector('form').onsubmit = event => { event.preventDefault(); document.querySelector('output').textContent = 'One confirmation' }; document.querySelector('input').focus() })()`,
			)
			const toolset = createBrowserToolset(page)
			toolsets.push(toolset)
			await toolset.start()
			const field = requireValue((await page.elements.find({ role: 'textbox', name: 'Name' }))[0])
			const button = requireValue((await page.elements.find({ role: 'button', name: 'Submit' }))[0])
			const args =
				action === 'click'
					? { ref: button.reference }
					: action === 'type'
						? { ref: field.reference, text: 'Ada', submit: true }
						: { key: 'Enter' }
			const receipt = requireToolText(
				await toolset.tools.execute({ id: 'submit', name: action, arguments: args }),
			)
			expect(receipt).toContain('the page handled the submission and changed')
			expect(receipt).toContain('One confirmation')
			expect(
				await requireValue((await page.frames())[0]).evaluate(
					`globalThis[${JSON.stringify(BROWSER_SUBMIT_KEY)}] === undefined`,
				),
			).toBe(true)
		},
	)

	it.each(['navigation', 'dialog', 'abort', 'detach'])(
		'reading campaign: releases submission observation on %s',
		async (outcome) => {
			const page = await browser.create({ url: fixtures.url('/form') })
			opened.push(page)
			const destination = fixtures.url('/shop/cart')
			const code =
				outcome === 'navigation'
					? `setTimeout(() => location.href = ${JSON.stringify(destination)}, 200)`
					: outcome === 'dialog'
						? 'setTimeout(() => confirm("Continue?"), 200)'
						: outcome === 'detach'
							? 'setTimeout(() => frameElement.remove(), 200)'
							: ''
			const html = '<form><label>Name<input></label><button>Submit</button></form>'
			if (outcome === 'detach')
				await page.evaluate(
					`(() => { document.body.innerHTML = '<h1>Frame removed</h1>'; const frame = document.createElement('iframe'); frame.srcdoc = ${JSON.stringify(html + `<script>document.querySelector('form').onsubmit = event => { event.preventDefault(); ${code} }</script>`)}; document.body.append(frame) })()`,
				)
			else
				await page.evaluate(
					`(() => { document.body.innerHTML = ${JSON.stringify(html)}; document.querySelector('form').onsubmit = event => { event.preventDefault(); ${code} } })()`,
				)
			const toolset = createBrowserToolset(page)
			toolsets.push(toolset)
			await toolset.start()
			const buttons = await page.elements.wait({ role: 'button', name: 'Submit' })
			const controller = new AbortController()
			const pending = toolset.tools.execute(
				{ id: 'submit', name: 'click', arguments: { ref: requireValue(buttons[0]).reference } },
				{ signal: controller.signal },
			)
			if (outcome === 'abort') {
				await waitForCondition(
					'submission reached the real observer',
					async () =>
						(await requireValue((await page.frames())[0]).evaluate(
							`(globalThis[${JSON.stringify(BROWSER_SUBMIT_KEY)}]?.events.length ?? 0) > 0`,
						)) === true,
				)
				controller.abort(new Error('Stop this submission'))
			}
			const result = await pending
			const content = expect.stringContaining(
				outcome === 'navigation'
					? 'Your cart holds'
					: outcome === 'detach'
						? 'Frame removed'
						: 'A confirm dialog is open',
			)
			const expected =
				outcome === 'abort'
					? { success: false, error: 'Stop this submission' }
					: { success: true, value: content }
			expect(result).toMatchObject(expected)
			expect((result.success ? requireToolText(result) : result.error).length).toBeLessThanOrEqual(
				BROWSER_TOOL_LIMIT,
			)
			expect(page.url).toBe(outcome === 'navigation' ? destination : fixtures.url('/form'))
			if (outcome === 'dialog')
				requireToolText(
					await toolset.tools.execute({
						id: 'answer',
						name: 'dialog',
						arguments: { accept: true },
					}),
				)
			await waitForCondition(
				'the observer is released',
				async () =>
					(await requireValue((await page.frames())[0]).evaluate(
						`globalThis[${JSON.stringify(BROWSER_SUBMIT_KEY)}] === undefined`,
					)) === true,
			)
			expect(await toolset.read()).toContain('page ')
		},
	)

	it('carries pressed and expanded CDP states into read with a plain-button control', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		await page.evaluate(`document.body.innerHTML = ${JSON.stringify(SERVICE_TOGGLE_HTML)}`)
		const toolset = createBrowserToolset(page)
		toolsets.push(toolset)
		await toolset.start()
		const reading = requireToolText(
			await toolset.tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
		)
		expect(collectOutlineEntries(reading)).toEqual(
			expect.arrayContaining([
				'button "Toggle on" pressed=true',
				'button "Toggle off" pressed=false',
				'button "Toggle mixed" pressed=mixed',
				'button "Disclosure" expanded=false',
				'link "Expanded link" /form expanded=true',
				'button "Plain toggle control"',
			]),
		)
		expect(collectOutlineEntries(reading)).toEqual(
			collectOutlineEntries(
				(await page.elements.outline()).lines.map(renderBrowserLine).join('\n'),
			),
		)
	})

	it('runs one task end to end: read, click the text field by reference, type with submit, and read the result page, each receipt whole and under BROWSER_TOOL_LIMIT', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()

		const reading = requireToolText(
			await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
		)
		const [name, notes, speed, standard, express, submit, save, review] = extractOutlineRows(
			reading,
		).map((row) => row.reference)
		const form = [
			`page "Delivery form" ${fixtures.url('/form')} (12 lines)`,
			'1: # Delivery form',
			'2: Name',
			`3: ${name} textbox "Name" value="Ada"`,
			'4: Notes',
			`5: ${notes} textbox "Notes" value="Leave at the door"`,
			'6: Speed',
			`7: ${speed} combobox "Speed" value="Standard" expanded=false`,
			`8: ${standard} option "Standard" selected=true`,
			`9: ${express} option "Express" selected=false`,
			`10: ${submit} button "Submit"`,
			`11: ${save} button "Save draft"`,
			`12: ${review} button "Review"`,
			'[lines 1–12 of 12; the whole page]',
		].join('\n')
		expect(reading).toBe(form)
		expect(extractBrowserPage(reading).body).toBe(
			(await page.elements.outline()).lines.map(renderBrowserLine).join('\n'),
		)

		const click = requireToolText(
			await tools.execute({ id: 'click', name: 'click', arguments: { ref: name } }),
		)
		expect(click).toSatisfy((receipt: string) =>
			matchesToolReceipt(receipt, {
				action: `Clicked ${name} textbox "Name"; call type with ${name} to enter text`,
				view: form,
			}),
		)
		expect(await page.evaluate('document.activeElement.id')).toBe('name')

		const typed = requireToolText(
			await tools.execute({
				id: 'type',
				name: 'type',
				arguments: { ref: name, text: 'Grace Hopper', submit: true },
			}),
		)
		const placed = fixtures.url(
			'/form/placed?name=Grace+Hopper&notes=Leave+at+the+door&speed=Standard',
		)
		const result = [
			`page "Order placed" ${placed} (2 lines)`,
			'1: # Order placed',
			'2: Delivery booked for Grace Hopper at Standard speed.',
			'[lines 1–2 of 2; the whole page]',
		].join('\n')
		expect(typed).toSatisfy((receipt: string) =>
			matchesToolReceipt(receipt, {
				action: `Typed "Grace Hopper" into ${name} textbox "Name" and submitted the form`,
				view: result,
				url: placed,
			}),
		)
		await waitForCondition(
			'the submission committed and rendered the placed page',
			async () => page.url === placed && (await toolset.read()) === result,
			{ budget: 10_000, interval: 20 },
		)

		const read = requireToolText(
			await tools.execute({ id: 'read', name: 'read', arguments: { from: 1 } }),
		)
		expect(read).toBe(result)
		const repeated = requireToolText(
			await tools.execute({ id: 'repeat', name: 'read', arguments: { from: 1, search: '' } }),
		)
		expect(repeated).toBe(result)

		expect(
			[reading, click, typed, read, repeated].filter(
				(receipt) => receipt.length > BROWSER_TOOL_LIMIT,
			),
		).toStrictEqual([])
	})

	describe('read past the cut view', () => {
		it('lists the Tracking number textbox first on a page whose text before it runs past the limit, and its reference types into the field (control: a reading that shares no word starts with the page line)', async () => {
			const page = await browser.create({ url: fixtures.url('/form') })
			opened.push(page)
			await page.evaluate(
				`(() => { document.querySelector('main').insertAdjacentHTML('afterbegin', ${JSON.stringify(SERVICE_TRACKING_HTML)}); return true })()`,
			)
			const tools = createToolManager()
			const toolset = createBrowserToolset(page, { tools })
			toolsets.push(toolset)
			await toolset.start()
			const outline = (await page.elements.outline()).lines.map(renderBrowserLine).join('\n')
			const tracking = requireOutlineReference(outline, 'textbox', 'Tracking number')
			expect(outline.indexOf(`${tracking} textbox`)).toBeGreaterThan(BROWSER_TOOL_LIMIT)

			const reading = requireToolText(
				await tools.execute({
					id: 'reading',
					name: 'read',
					arguments: { from: 1, search: 'the Tracking number textbox' },
				}),
			)
			expect(reading).toContain(`2 lines match "the Tracking number textbox":`)
			expect(reading).toContain(`${tracking} textbox "Tracking number"`)
			expect(extractBrowserPage(reading).body.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
			expect(
				await tools.execute({
					id: 'type',
					name: 'type',
					arguments: { ref: tracking, text: '1Z999AA10123456784' },
				}),
			).toMatchObject({ success: true })
			expect(await page.evaluate("document.getElementById('tracking').value")).toBe(
				'1Z999AA10123456784',
			)

			const control = requireToolText(
				await tools.execute({
					id: 'control',
					name: 'read',
					arguments: { from: 1, search: 'zebra crossing' },
				}),
			)
			expect(control.startsWith('page "Delivery form" ')).toBe(true)
			expect(control).not.toContain(`${tracking} textbox`)
		})

		it('pages the outline of that page through to its count line', async () => {
			const page = await browser.create({ url: fixtures.url('/form') })
			opened.push(page)
			await page.evaluate(
				`(() => { document.querySelector('main').insertAdjacentHTML('afterbegin', ${JSON.stringify(SERVICE_TRACKING_HTML)}); return true })()`,
			)
			const tools = createToolManager()
			const toolset = createBrowserToolset(page, { tools })
			toolsets.push(toolset)
			await toolset.start()
			const bodies: string[] = []
			let from: number | undefined = 1
			while (from !== undefined) {
				const paged = extractBrowserPage(
					requireToolText(
						await tools.execute({ id: 'reading', name: 'read', arguments: { from } }),
					),
				)
				expect(paged.start).toBe(from)
				expect(paged.body.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
				bodies.push(paged.body)
				from = paged.next
			}
			expect(bodies.length).toBeGreaterThan(1)
			expect(bodies.join('\n')).toBe(
				(await page.elements.outline({ limit: Number.MAX_SAFE_INTEGER })).lines
					.map(renderBrowserLine)
					.join('\n'),
			)
		})

		it('names the focused element in the receipt of each Tab press', async () => {
			const page = await browser.create({ url: fixtures.url('/form') })
			opened.push(page)
			const tools = createToolManager()
			const toolset = createBrowserToolset(page, { tools })
			toolsets.push(toolset)
			await toolset.start()
			const outline = (await page.elements.outline()).lines.map(renderBrowserLine).join('\n')
			const name = requireOutlineReference(outline, 'textbox', 'Name')
			const notes = requireOutlineReference(outline, 'textbox', 'Notes')
			const first = requireToolText(
				await tools.execute({ id: 'first', name: 'press', arguments: { key: 'Tab' } }),
			)
			expect(first.split('\n', 1)[0]).toBe(
				`Pressed Tab; focus is on ${name} textbox "Name" value="Ada".`,
			)
			expect(await page.evaluate('document.activeElement.id')).toBe('name')
			const second = requireToolText(
				await tools.execute({ id: 'second', name: 'press', arguments: { key: 'Tab' } }),
			)
			expect(second.split('\n', 1)[0]).toBe(
				`Pressed Tab; focus is on ${notes} textbox "Notes" value="Leave at the door".`,
			)
			expect(await page.evaluate('document.activeElement.id')).toBe('notes')
		})
	})

	it('returns the cart view in the receipt of a click whose POST form the server answers with 303, and the same page with the handled status for a form whose submit handler prevents the submission', async () => {
		const page = await browser.create({ url: fixtures.url('/shop') })
		opened.push(page)
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()
		const reading = requireToolText(
			await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
		)
		const add = requireOutlineReference(reading, 'button', 'Add to cart')
		const hold = requireOutlineReference(reading, 'button', 'Save for later')

		const held = requireToolText(
			await tools.execute({ id: 'hold', name: 'click', arguments: { ref: hold } }),
		)
		expect(held).toBe(
			`Clicked ${hold} button "Save for later"; the page handled the submission and has not changed yet; do not submit again; call read or wait for the text you expect.\n\n${reading}`,
		)
		expect(await page.evaluate('document.body.dataset.held')).toBe('yes')
		expect(page.url).toBe(fixtures.url('/shop'))

		const added = requireToolText(
			await tools.execute({ id: 'add', name: 'click', arguments: { ref: add } }),
		)
		expect(added).toBe(
			[
				`Clicked ${add} button "Add to cart".`,
				'',
				`page "Cart" ${fixtures.url('/shop/cart')} (2 lines)`,
				'1: # Cart',
				'2: Your cart holds the Cedar Tea Tray.',
				'[lines 1–2 of 2; the whole page]',
			].join('\n'),
		)
	})

	it('names the page handling of a type with submit whose submission the page script prevents and posts, returning its confirmation, which a following wait also finds (control: a form that navigates keeps the destination view)', async () => {
		const page = await browser.create({ url: fixtures.url('/checkout') })
		opened.push(page)
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()
		const reading = requireToolText(
			await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
		)
		const name = requireOutlineReference(reading, 'textbox', 'Name')
		const recipient = requireOutlineReference(reading, 'textbox', 'Gift name')
		const confirmation = `Order ${FIXTURE_CHECKOUT_CODE} placed for Ada Lovelace.`

		const typed = requireToolText(
			await tools.execute({
				id: 'order',
				name: 'type',
				arguments: { ref: name, text: 'Ada Lovelace', submit: true },
			}),
		)
		expect(typed.split('\n', 1)[0]).toBe(
			`Typed "Ada Lovelace" into ${name} textbox "Name" and submitted the form; the page handled the submission and changed.`,
		)
		expect(typed).toContain(`\n\npage "Checkout" ${fixtures.url('/checkout')} (`)
		expect(typed).toContain(`${name} textbox "Name" value="Ada Lovelace"`)
		expect(typed).toContain(FIXTURE_CHECKOUT_CODE)
		expect(page.url).toBe(fixtures.url('/checkout'))

		expect(
			requireToolText(
				await tools.execute({ id: 'wait', name: 'wait', arguments: { text: confirmation } }),
			),
		).toContain(`${JSON.stringify(confirmation)} is on the page.\n\npage `)

		const gift = requireToolText(
			await tools.execute({
				id: 'gift',
				name: 'type',
				arguments: { ref: recipient, text: 'Grace Hopper', submit: true },
			}),
		)
		const placed = fixtures.url('/form/placed?speed=Standard&name=Grace+Hopper')
		const view = [
			`page "Order placed" ${placed} (2 lines)`,
			'1: # Order placed',
			'2: Delivery booked for Grace Hopper at Standard speed.',
			'[lines 1–2 of 2; the whole page]',
		].join('\n')
		expect(gift).toSatisfy((receipt: string) =>
			matchesToolReceipt(receipt, {
				action: `Typed "Grace Hopper" into ${recipient} textbox "Gift name" and submitted the form`,
				view,
				url: placed,
			}),
		)
	})

	it('outlines editable regions by role and types only into a referenced text role, filling a role="textbox" region through the trusted path', async () => {
		const page = await browser.create({ url: fixtures.url('/document') })
		opened.push(page)
		await page.evaluate(
			`(() => { document.querySelector('main').insertAdjacentHTML('beforeend', ${JSON.stringify(SERVICE_EDITABLE_HTML)}); return true })()`,
		)
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()
		const reading = requireToolText(
			await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
		)
		const notes = requireOutlineReference(reading, 'textbox', 'Notes')
		const bold = requireOutlineReference(reading, 'button', 'Bold')
		const coupon = requireOutlineReference(reading, 'button', 'Coupon')
		expect(extractBrowserPage(reading).body).toContain(
			[
				'Plain notes',
				`${notes} textbox "Notes"`,
				'Draft',
				`${bold} button "Bold"`,
				`${coupon} button "Coupon"`,
			].join('\n'),
		)
		expect(extractOutlineRows(reading).map((row) => row.name)).not.toContain('Plain notes')

		expect(
			await tools.execute({ id: 'notes', name: 'type', arguments: { ref: notes, text: 'kettle' } }),
		).toMatchObject({
			success: true,
			value: expect.stringMatching(`^Typed "kettle" into ${notes} textbox "Notes"\\.\\n\\npage "`),
		})
		expect(await page.evaluate("document.querySelector('[role=textbox]').textContent")).toBe(
			'kettle',
		)
		const refused = await tools.execute([
			{ id: 'bold', name: 'type', arguments: { ref: bold, text: 'kettle' } },
			{ id: 'coupon', name: 'type', arguments: { ref: coupon, text: 'kettle' } },
		])
		expect(refused).toMatchObject([
			{
				success: false,
				error: `Element ${bold} button "Bold" takes no text; call click for a button.`,
			},
			{
				success: false,
				error: `Element ${coupon} button "Coupon" takes no text; call click for a button.`,
			},
		])
		expect(await page.evaluate("document.querySelector('[aria-label=Coupon]').value")).toBe('')
	})

	it('stages dialog when a click fires confirm(); the receipt names the dialog, and dialog accept settles the blocked click with no second receipt (control: a click without a dialog returns the plain receipt)', async () => {
		const page = await browser.create({ url: fixtures.url('/confirm') })
		opened.push(page)
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()
		const reading = requireToolText(
			await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
		)
		const remove = requireOutlineReference(reading, 'button', 'Delete')
		const keep = requireOutlineReference(reading, 'button', 'Keep')
		const drafts = [
			`page "Drafts" ${fixtures.url('/confirm')} (3 lines)`,
			'1: # Drafts',
			`2: ${remove} button "Delete"`,
			`3: ${keep} button "Keep"`,
			'[lines 1–3 of 3; the whole page]',
		].join('\n')
		expect(reading).toBe(drafts)
		const kept = { action: `Clicked ${keep} button "Keep"`, view: drafts }

		const plain = requireToolText(
			await tools.execute({ id: 'keep', name: 'click', arguments: { ref: keep } }),
		)
		expect(plain).toSatisfy((receipt: string) => matchesToolReceipt(receipt, kept))
		expect(await page.evaluate('document.body.dataset.kept')).toBe('1')
		expect(tools.tool('dialog')).toBeUndefined()

		const blocked = requireToolText(
			await tools.execute({ id: 'delete', name: 'click', arguments: { ref: remove } }),
		)
		expect(blocked).toBe(
			`Clicked ${remove} button "Delete". A confirm dialog is open: "Delete the draft?"; call dialog.`,
		)
		expect(tools.definitions().map((definition) => definition.name)).toContain('dialog')

		const accepted = requireToolText(
			await tools.execute({ id: 'dialog', name: 'dialog', arguments: { accept: true } }),
		)
		expect(accepted).toSatisfy((receipt: string) =>
			matchesToolReceipt(receipt, {
				action: 'Accepted the confirm dialog "Delete the draft?"',
				view: drafts,
			}),
		)
		expect(await page.evaluate('document.body.dataset.answer')).toBe('true')
		expect(tools.tool('dialog')).toBeUndefined()

		// The next action awaits the settled click and carries only its own receipt line.
		const after = requireToolText(
			await tools.execute({ id: 'again', name: 'click', arguments: { ref: keep } }),
		)
		expect(after).toSatisfy((receipt: string) => matchesToolReceipt(receipt, kept))
		expect(await page.evaluate('document.body.dataset.kept')).toBe('2')
	})

	it('names the beforeunload dialog in a link click receipt, and the accepted dialog commits the navigation (control: the link on a page without the handler navigates in one receipt)', async () => {
		const page = await browser.create()
		opened.push(page)
		// The document reaches network idle before the click, so the next idle belongs to the
		// document the accepted dialog commits.
		await page.navigate(fixtures.url('/beforeunload'), { condition: 'idle' })
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()
		const next = requireOutlineReference(
			requireToolText(await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } })),
			'link',
			'Next',
		)

		const clicked = requireToolText(
			await tools.execute({ id: 'click', name: 'click', arguments: { ref: next } }),
		)
		expect(clicked).toBe(
			`Clicked ${next} link "Next". A beforeunload dialog is open: ""; call dialog.`,
		)
		expect(page.url).toBe(fixtures.url('/beforeunload'))

		// The idle wait carries a handler from the moment it starts, and `finally` ends and drains
		// it, so a failed dialog step leaves no rejection behind and keeps its own failure.
		const ending = new AbortController()
		const idle = page.navigation.idle({ timeout: 10_000, signal: ending.signal })
		const drained = idle.catch(() => undefined)
		try {
			const accepted = requireToolText(
				await tools.execute({ id: 'dialog', name: 'dialog', arguments: { accept: true } }),
			)
			// The view this receipt carries races the committing navigation, so only its action
			// line is fixed.
			expect(accepted.split('\n', 1)[0]).toBe('Accepted the beforeunload dialog "".')
			await idle
		} finally {
			ending.abort()
			await drained
		}
		expect(page.url).toBe(fixtures.url('/beforeunload/next'))
		const destination = [
			`page "Next note" ${fixtures.url('/beforeunload/next')} (1 lines)`,
			'1: # Next note',
			'[lines 1–1 of 1; the whole page]',
		].join('\n')
		expect(
			requireToolText(await tools.execute({ id: 'after', name: 'read', arguments: { from: 1 } })),
		).toBe(destination)

		const plain = await browser.create({ url: fixtures.url('/beforeunload/plain') })
		opened.push(plain)
		const controls = createToolManager()
		const control = createBrowserToolset(plain, { tools: controls })
		toolsets.push(control)
		await control.start()
		const link = requireOutlineReference(
			requireToolText(
				await controls.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
			),
			'link',
			'Next',
		)
		expect(
			requireToolText(
				await controls.execute({ id: 'click', name: 'click', arguments: { ref: link } }),
			),
		).toSatisfy((receipt: string) =>
			matchesToolReceipt(receipt, {
				action: `Clicked ${link} link "Next"`,
				view: destination,
				url: fixtures.url('/beforeunload/next'),
			}),
		)
		expect(controls.tool('dialog')).toBeUndefined()
		await waitForCondition(
			'the control link committed and rendered the next note',
			async () =>
				plain.url === fixtures.url('/beforeunload/next') && (await control.read()) === destination,
			{ budget: 10_000, interval: 20 },
		)
	})

	describe('a popup that window.open creates from a trusted click', () => {
		const suite = createTeardown()
		let toolset: BrowserToolsetInterface
		let child: string

		// Establishes every step before the cursor assertion: the context, the navigation, the
		// toolset, the reference, the activation click, whose receipt names the move, and a second
		// protocol connection's `Target.getTargets` listing the child page with the opener's
		// `openerId`.
		beforeAll(async () => {
			const context = await browser.isolate()
			suite.add(() => context.close())
			const page = await context.create({ url: fixtures.url('/popup') })
			const tools = createToolManager()
			const started = createBrowserToolset(page, { tools, context })
			suite.add(() => started.destroy())
			await started.start()
			toolset = started
			const catalog = requireToolText(
				await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
			)
			const open = requireOutlineReference(catalog, 'button', 'Open details')
			child = fixtures.url('/popup/child')
			const clicked = requireToolText(
				await tools.execute({ id: 'click', name: 'click', arguments: { ref: open } }),
			)
			if (!clicked.includes(`The view moved to a new tab: ${child}.`))
				throw new Error(
					`Precondition failed: the Open details click returned ${JSON.stringify(clicked)}`,
				)

			const version: unknown = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
			const endpoint = isRecord(version) ? version['webSocketDebuggerUrl'] : undefined
			if (!isString(endpoint))
				throw new Error('Precondition failed: Chromium reported no debugger URL.')
			const client: CDPClientInterface = createCDPClient({
				transport: createCDPTransport({ url: endpoint }),
				timeout: 10_000,
			})
			suite.add(() => client.close())
			await client.connect()
			await retryUntil(
				'precondition: Target.getTargets lists the child page with the opener as its openerId',
				() => client.send('Target.getTargets'),
				(targets) =>
					isRecord(targets) &&
					isArray(targets['targetInfos']) &&
					targets['targetInfos'].some(
						(info) => isRecord(info) && info['url'] === child && info['openerId'] === page.target,
					),
				{ budget: 5_000, interval: 50 },
			)
		})

		afterAll(async () => {
			await suite.destroy()
		})

		it('moves the cursor to the popup the click opened', async () => {
			await expect(
				waitForCondition('the view moved to the popup', () => toolset.view.url === child, {
					budget: 5_000,
					interval: 20,
				}),
			).resolves.toBeUndefined()
		})
	})

	it('keeps the view on the page when a click opens no popup: tabs lists one current tab (control for the popup case)', async () => {
		const context = await browser.isolate()
		contexts.push(context)
		const page = await context.create({ url: fixtures.url('/popup') })
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools, context })
		toolsets.push(toolset)
		await toolset.start()
		const catalog = requireToolText(
			await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
		)
		const stay = requireOutlineReference(catalog, 'button', 'Stay')

		expect(
			requireToolText(
				await tools.execute({ id: 'click', name: 'click', arguments: { ref: stay } }),
			),
		).toSatisfy((receipt: string) =>
			matchesToolReceipt(receipt, { action: `Clicked ${stay} button "Stay"`, view: catalog }),
		)
		expect(await page.evaluate('document.body.dataset.stayed')).toBe('yes')
		expect(
			requireToolText(await tools.execute({ id: 'tabs', name: 'read', arguments: { from: 1 } })),
		).toBe(catalog)
		expect(toolset.view).toBe(page)
		expect(context.pages()).toStrictEqual([page])
	})

	describe('two tabs of one context', () => {
		let context: BrowserContextInterface
		let catalogPage: BrowserPageInterface
		let detailsPage: BrowserPageInterface
		let tools: ToolManagerInterface
		let toolset: BrowserToolsetInterface
		let catalog: string

		afterEach(async () => {
			await toolset.destroy().catch(() => undefined)
			await context.close().catch(() => undefined)
		})

		// Each case opens both tabs and starts a context-scoped toolset on the first tab.
		beforeEach(async () => {
			context = await browser.isolate()
			catalogPage = await context.create({ url: fixtures.url('/popup') })
			detailsPage = await context.create({ url: fixtures.url('/popup/child') })
			tools = createToolManager()
			toolset = createBrowserToolset(catalogPage, { tools, context })
			await toolset.start()
			catalog = requireToolText(
				await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
			)
		})

		it('moves the cursor between the tabs with switch, and the page tools follow it', async () => {
			const selected = createRecorder<[unknown]>()
			toolset.emitter.on('select', selected.handler)
			expect(
				requireToolText(await tools.execute({ id: 'tabs', name: 'read', arguments: { from: 1 } })),
			).toContain('tabs: t1 "Catalog" (current), t2 "Details"')
			expect(await toolset.tabs()).toStrictEqual([
				{ id: 't1', title: 'Catalog', url: fixtures.url('/popup'), current: true },
				{ id: 't2', title: 'Details', url: fixtures.url('/popup/child'), current: false },
			])

			const moved = requireToolText(
				await tools.execute({ id: 'switch', name: 'switch', arguments: { tab: 't2' } }),
			)
			expect(toolset.view).toBe(detailsPage)
			const details = await toolset.read()
			expect(moved).toSatisfy((receipt: string) =>
				matchesToolReceipt(receipt, {
					action: `Switched to t2 ${fixtures.url('/popup/child')}`,
					view: details,
				}),
			)
			const like = requireOutlineReference(details, 'button', 'Like')
			expect(
				requireToolText(
					await tools.execute({ id: 'like', name: 'click', arguments: { ref: like } }),
				),
			).toSatisfy((receipt: string) =>
				matchesToolReceipt(receipt, { action: `Clicked ${like} button "Like"`, view: details }),
			)
			expect(await detailsPage.evaluate('document.body.dataset.liked')).toBe('yes')

			const back = requireToolText(
				await tools.execute({ id: 'back', name: 'switch', arguments: { tab: 't1' } }),
			)
			expect(back).toSatisfy((receipt: string) =>
				matchesToolReceipt(receipt, {
					action: `Switched to t1 ${fixtures.url('/popup')}`,
					view: catalog,
				}),
			)
			expect(toolset.view).toBe(catalogPage)
			expect(selected.calls).toStrictEqual([[detailsPage], [catalogPage]])
		})

		it('returns the cursor to the first tab when the tab it moved to closes, and the next result names the return', async () => {
			await tools.execute({ id: 'switch', name: 'switch', arguments: { tab: 't2' } })
			expect(toolset.view).toBe(detailsPage)
			const closed = detailsPage.url

			await detailsPage.close()
			await waitForCondition(
				'the view returned to the first tab',
				() => toolset.view === catalogPage,
				{
					budget: 5_000,
					interval: 20,
				},
			)
			expect(
				requireToolText(
					await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
				),
			).toContain(`The tab ${closed} closed; the view returned to ${fixtures.url('/popup')}.`)
		})
	})

	// Pins this ordering: the Enter that submits the framed form navigates the `localhost` frame to
	// `127.0.0.1`, another site and process, while its key-up is still to be sent. The receipt waits
	// for the frame's request on its own session and its commit and stop on the page session, so it
	// carries the frame's destination view.
	it('returns the destination view in the receipt of a type with submit that navigates an out-of-process frame to another process', async () => {
		const page = await browser.create()
		opened.push(page)
		const attached = createRecorder<[Readonly<Record<string, unknown>>]>()
		await page.subscribe('Target.attachedToTarget', attached.handler)
		await page.navigate(fixtures.url('/frame/voucher'))
		await waitForCondition(
			'precondition: the localhost voucher field attached as its own iframe target',
			() =>
				attached.calls.some(
					([params]) => isRecord(params['targetInfo']) && params['targetInfo']['type'] === 'iframe',
				),
			{ budget: 10_000, interval: 20 },
		)
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()
		await waitForCondition(
			'precondition: the outline lists the framed Code field',
			async () =>
				(await page.elements.outline()).lines
					.map(renderBrowserLine)
					.join('\n')
					.includes('textbox "Code"'),
			{ budget: 10_000, interval: 20 },
		)
		expect((await page.frames()).map((frame) => frame.url)).toContain(
			fixtures.url('/frame/field', 'localhost'),
		)
		const reading = requireToolText(
			await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
		)
		const frame = requireOutlineReference(reading, 'Iframe', 'Voucher form')
		const code = requireOutlineReference(reading, 'textbox', 'Code')

		const receipt = requireToolText(
			await tools.execute({
				id: 'type',
				name: 'type',
				arguments: { ref: code, text: 'SPRING', submit: true },
			}),
		)
		const applied = [
			`page "Voucher" ${fixtures.url('/frame/voucher')} (4 lines)`,
			'1: # Voucher',
			`2: ${frame} Iframe "Voucher form"`,
			'3: # Voucher applied',
			'4: Received key Enter',
			'[lines 1–4 of 4; the whole page]',
		].join('\n')
		expect(receipt).toBe(
			`Typed "SPRING" into ${code} textbox "Code" and submitted the form.\n\n${applied}`,
		)
		// The frame's keydown listener put the Enter into the submitted query, so the committed
		// URL is evidence that the key-down reached the frame.
		const done = fixtures.url('/frame/done?code=SPRING&key=Enter')
		await waitForCondition(
			'the framed form committed its cross-process navigation',
			async () => (await page.frames()).some((candidate) => candidate.url === done),
			{ budget: 10_000, interval: 20 },
		)
		await waitForCondition(
			'the committed frame rendered the key it received',
			async () => (await toolset.read()) === applied,
			{ budget: 10_000, interval: 20 },
		)
		expect(
			requireToolText(await tools.execute({ id: 'after', name: 'read', arguments: { from: 1 } })),
		).toBe(applied)
	})

	it('returns the destination view in the receipt of a type with submit that navigates an in-process frame out to another process', async () => {
		const page = await browser.create({ url: fixtures.url('/frame/local') })
		opened.push(page)
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()
		await waitForCondition(
			'precondition: the outline lists the framed Code field',
			async () =>
				(await page.elements.outline()).lines
					.map(renderBrowserLine)
					.join('\n')
					.includes('textbox "Code"'),
			{ budget: 10_000, interval: 20 },
		)
		const reading = requireToolText(
			await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
		)
		const frame = requireOutlineReference(reading, 'Iframe', 'Voucher form')
		const code = requireOutlineReference(reading, 'textbox', 'Code')

		const receipt = requireToolText(
			await tools.execute({
				id: 'type',
				name: 'type',
				arguments: { ref: code, text: 'SPRING', submit: true },
			}),
		)
		const applied = [
			`page "Local voucher" ${fixtures.url('/frame/local')} (4 lines)`,
			'1: # Local voucher',
			`2: ${frame} Iframe "Voucher form"`,
			'3: # Voucher applied',
			'4: Received key Enter',
			'[lines 1–4 of 4; the whole page]',
		].join('\n')
		expect(receipt).toBe(
			`Typed "SPRING" into ${code} textbox "Code" and submitted the form.\n\n${applied}`,
		)
		expect((await page.frames()).map((candidate) => candidate.url)).toContain(
			fixtures.url('/frame/done?code=SPRING&key=Enter', 'localhost'),
		)
	})

	it('returns the parent frame destination in the receipt of a type with submit whose nested out-of-process form targets _parent', async () => {
		const page = await browser.create({ url: fixtures.url('/frame/nested') })
		opened.push(page)
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()
		await waitForCondition(
			'precondition: the outline lists the Coupon field of the innermost frame',
			async () =>
				(await page.elements.outline()).lines
					.map(renderBrowserLine)
					.join('\n')
					.includes('textbox "Coupon"'),
			{ budget: 10_000, interval: 20 },
		)
		const inner = (await page.frames()).find(
			(candidate) => candidate.url === fixtures.url('/frame/inner'),
		)
		const middle = (await page.frames()).find(
			(candidate) => candidate.url === fixtures.url('/frame/middle', 'localhost'),
		)
		expect(inner?.parent).toBe(requireValue(middle).id)
		const reading = requireToolText(
			await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
		)
		const coupon = requireOutlineReference(reading, 'textbox', 'Coupon')

		const receipt = requireToolText(
			await tools.execute({
				id: 'type',
				name: 'type',
				arguments: { ref: coupon, text: 'SPRING', submit: true },
			}),
		)
		expect(receipt.split('\n', 1)[0]).toBe(
			`Typed "SPRING" into ${coupon} textbox "Coupon" and submitted the form.`,
		)
		const view = receipt.slice(receipt.indexOf('\n\n'))
		expect(view).toContain('# Voucher applied')
		expect(view).not.toContain('textbox "Coupon"')
		expect((await page.frames()).map((candidate) => candidate.url)).toContain(
			fixtures.url('/frame/done?code=SPRING'),
		)
	})

	it('returns the same page at its fragment in the receipt of a click whose form submission stays within the document', async () => {
		const page = await browser.create({ url: fixtures.url('/search?q=tray') })
		opened.push(page)
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()
		const reading = requireToolText(
			await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
		)
		const find = requireOutlineReference(reading, 'button', 'Find')
		const started = performance.now()
		const receipt = requireToolText(
			await tools.execute({ id: 'find', name: 'click', arguments: { ref: find } }),
		)
		const elapsed = performance.now() - started
		expect(receipt).toBe(
			[
				`Clicked ${find} button "Find".`,
				'',
				`page "Search" ${fixtures.url('/search?q=tray#found')} (2 lines)`,
				'1: # Search',
				`2: ${find} button "Find"`,
				'[lines 1–2 of 2; the whole page]',
			].join('\n'),
		)
		expect(elapsed).toBeLessThan(BROWSER_TOOL_TIMEOUT_MS - 1_000)
	})

	// Asserts the guide's receipt deadline, `BROWSER_TOOL_TIMEOUT_MS` (5 000 ms), with the
	// captured view in place of any note, one case per claim. Envelope: this file's one Chromium,
	// the service project running its files one at a time, and no other browser work on the host.
	// A busier host can exceed the deadline without a library defect; the preceding cases carry
	// the behaviour under any load.
	describe('performance within the receipt deadline', () => {
		it('returns the loaded result page of a type with submit within the deadline', async () => {
			const page = await browser.create({ url: fixtures.url('/form') })
			opened.push(page)
			const tools = createToolManager()
			const toolset = createBrowserToolset(page, { tools })
			toolsets.push(toolset)
			await toolset.start()
			const name = requireOutlineReference(
				requireToolText(
					await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
				),
				'textbox',
				'Name',
			)

			const started = performance.now()
			const typed = requireToolText(
				await tools.execute({
					id: 'type',
					name: 'type',
					arguments: { ref: name, text: 'Grace Hopper', submit: true },
				}),
			)
			const elapsed = performance.now() - started
			const placed = fixtures.url(
				'/form/placed?name=Grace+Hopper&notes=Leave+at+the+door&speed=Standard',
			)
			const view = [
				`page "Order placed" ${placed} (2 lines)`,
				'1: # Order placed',
				'2: Delivery booked for Grace Hopper at Standard speed.',
				'[lines 1–2 of 2; the whole page]',
			].join('\n')
			expect(typed).toBe(
				`Typed "Grace Hopper" into ${name} textbox "Name" and submitted the form.\n\n${view}`,
			)
			expect(elapsed).toBeLessThan(BROWSER_TOOL_TIMEOUT_MS)
		})

		it('returns the dialog-naming click receipt and the accepted dialog receipt each within the deadline', async () => {
			const page = await browser.create({ url: fixtures.url('/confirm') })
			opened.push(page)
			const tools = createToolManager()
			const toolset = createBrowserToolset(page, { tools })
			toolsets.push(toolset)
			await toolset.start()
			const drafts = requireToolText(
				await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
			)
			const remove = requireOutlineReference(drafts, 'button', 'Delete')

			const clicking = performance.now()
			const blocked = requireToolText(
				await tools.execute({ id: 'delete', name: 'click', arguments: { ref: remove } }),
			)
			const clicked = performance.now() - clicking
			const accepting = performance.now()
			const accepted = requireToolText(
				await tools.execute({ id: 'dialog', name: 'dialog', arguments: { accept: true } }),
			)
			const answered = performance.now() - accepting
			expect(blocked).toBe(
				`Clicked ${remove} button "Delete". A confirm dialog is open: "Delete the draft?"; call dialog.`,
			)
			expect(accepted).toBe(`Accepted the confirm dialog "Delete the draft?".\n\n${drafts}`)
			expect(clicked).toBeLessThan(BROWSER_TOOL_TIMEOUT_MS)
			expect(answered).toBeLessThan(BROWSER_TOOL_TIMEOUT_MS)
		})

		it('returns the loaded destination of a link click on a page without a beforeunload handler within the deadline', async () => {
			const page = await browser.create({ url: fixtures.url('/beforeunload/plain') })
			opened.push(page)
			const tools = createToolManager()
			const toolset = createBrowserToolset(page, { tools })
			toolsets.push(toolset)
			await toolset.start()
			const link = requireOutlineReference(
				requireToolText(
					await tools.execute({ id: 'reading', name: 'read', arguments: { from: 1 } }),
				),
				'link',
				'Next',
			)

			const started = performance.now()
			const clicked = requireToolText(
				await tools.execute({ id: 'click', name: 'click', arguments: { ref: link } }),
			)
			const elapsed = performance.now() - started
			expect(clicked).toBe(
				[
					`Clicked ${link} link "Next".`,
					'',
					`page "Next note" ${fixtures.url('/beforeunload/next')} (1 lines)`,
					'1: # Next note',
					'[lines 1–1 of 1; the whole page]',
				].join('\n'),
			)
			expect(elapsed).toBeLessThan(BROWSER_TOOL_TIMEOUT_MS)
		})

		it('returns the tab a switch moved to with its captured view within the deadline', async () => {
			const context = await browser.isolate()
			contexts.push(context)
			const first = await context.create({ url: fixtures.url('/popup') })
			const second = await context.create({ url: fixtures.url('/popup/child') })
			const tools = createToolManager()
			const toolset = createBrowserToolset(first, { tools, context })
			toolsets.push(toolset)
			await toolset.start()

			const started = performance.now()
			const moved = requireToolText(
				await tools.execute({ id: 'switch', name: 'switch', arguments: { tab: 't2' } }),
			)
			const elapsed = performance.now() - started
			expect(toolset.view).toBe(second)
			const details = await toolset.read()
			expect(moved).toBe(`Switched to t2 ${fixtures.url('/popup/child')}.\n\n${details}`)
			expect(elapsed).toBeLessThan(BROWSER_TOOL_TIMEOUT_MS)
		})
	})
})
