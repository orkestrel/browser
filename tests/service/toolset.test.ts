/**
 * Live-browser proofs for `BrowserToolset` over a real page, driven through `@orkestrel/tool`.
 *
 * Every toolset here is registered in a `createToolManager()` manager and every call runs through
 * that manager's `execute`, so a receipt is the text a model would read. The browser is the one
 * `tests/setupService.ts` resolves, launched once for the block with `--site-per-process` so the
 * `localhost` frame of the voucher page renders out of process; every page and context a case
 * opens is closed after it, and every toolset destroyed.
 *
 * One case is an expected failure: Chromium never attaches a page that `window.open` creates to
 * its opener's session, so the page's `popup` event never fires and the cursor never follows the
 * popup. The case asserts the whole intended behaviour and fails at the first step that needs the
 * event; the cursor mechanism itself is proven between two tabs of one context.
 */

import type { BrowserInterface } from '@src/server'
import type {
	BrowserContextInterface,
	BrowserPageInterface,
	BrowserToolsetInterface,
} from '@src/core'
import type { FixtureServerInterface } from '../setupServer.js'
import { describe, it, expect, afterAll, afterEach, beforeAll } from 'vitest'
import { createBrowser } from '@src/server'
import { BROWSER_TOOL_LIMIT, createBrowserToolset } from '@src/core'
import { isRecord } from '@orkestrel/contract'
import { createToolManager } from '@orkestrel/tool'
import { createRecorder, createTeardown, waitForCondition } from '@orkestrel/test'
import { createFixtureServer, createTempDirectory, reservePort } from '../setupServer.js'
import {
	extractOutlineRows,
	requireOutlineReference,
	requireSystemBrowser,
	requireToolText,
	SERVICE_BROWSER_ARGS,
} from '../setupService.js'

const REAL_BROWSER_EXECUTABLE = requireSystemBrowser().executable

describe('BrowserToolset over a real page through createToolManager().execute', () => {
	const teardown = createTeardown()
	const opened: BrowserPageInterface[] = []
	const contexts: BrowserContextInterface[] = []
	const toolsets: BrowserToolsetInterface[] = []
	let fixtures: FixtureServerInterface
	let browser: BrowserInterface

	// Each resource registers its release as soon as it exists, so a later acquisition that
	// rejects still releases the earlier ones.
	beforeAll(async () => {
		const server = await createFixtureServer()
		teardown.add(() => server.destroy())
		fixtures = server

		const profile = createTempDirectory('orkestrel-browser-profile-')
		teardown.add(() => profile.destroy())
		const launched = createBrowser({
			executable: REAL_BROWSER_EXECUTABLE,
			headless: true,
			profile: profile.path,
			args: [...SERVICE_BROWSER_ARGS, '--site-per-process'],
			cdp: { port: await reservePort() },
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

	it('runs one task end to end: look, click the text field by reference, type with submit, and read the result page, each receipt whole and under BROWSER_TOOL_LIMIT', async () => {
		const page = await browser.create({ url: fixtures.url('/form') })
		opened.push(page)
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()

		const look = requireToolText(
			await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the delivery form' } }),
		)
		const [name, notes, speed, standard, express, submit, save, review] = extractOutlineRows(
			look,
		).map((row) => row.reference)
		const form = [
			`page "Delivery form" ${fixtures.url('/form')}`,
			'# Delivery form',
			'Name',
			`${name} textbox "Name" value="Ada"`,
			'Ada',
			'Notes',
			`${notes} textbox "Notes" value="Leave at the door"`,
			'Leave at the door',
			'Speed',
			`${speed} combobox "Speed" value="Standard"`,
			`${standard} option "Standard"`,
			`${express} option "Express"`,
			`${submit} button "Submit"`,
			`${save} button "Save draft"`,
			`${review} button "Review"`,
			'(8 of 8 elements)',
		].join('\n')
		expect(look).toBe(form)
		expect(look).toBe((await page.elements.outline()).text)

		const click = requireToolText(
			await tools.execute({ id: 'click', name: 'click', arguments: { ref: name } }),
		)
		expect(click).toBe(`Clicked ${name} textbox "Name".\n\n${form}`)
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
			`page "Order placed" ${placed}`,
			'# Order placed',
			'Delivery booked for Grace Hopper at Standard speed.',
			'(0 of 0 elements)',
		].join('\n')
		expect(typed).toBe(
			`Typed "Grace Hopper" into ${name} textbox "Name" and submitted the form.\n\n${result}`,
		)
		expect(page.url).toBe(placed)
		expect((await page.elements.outline()).text).toBe(result)

		const read = requireToolText(
			await tools.execute({ id: 'read', name: 'read', arguments: { what: 'the confirmation' } }),
		)
		expect(read).toBe('# Order placed\n\nDelivery booked for Grace Hopper at Standard speed.')

		expect(
			[look, click, typed, read].filter((receipt) => receipt.length > BROWSER_TOOL_LIMIT),
		).toStrictEqual([])
	})

	it('P14 stages dialog when a click fires confirm(); the receipt names the dialog, and dialog accept settles the blocked click with no second receipt (control: a click without a dialog returns the plain receipt)', async () => {
		const page = await browser.create({ url: fixtures.url('/confirm') })
		opened.push(page)
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()
		const look = requireToolText(
			await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the drafts' } }),
		)
		const remove = requireOutlineReference(look, 'button', 'Delete')
		const keep = requireOutlineReference(look, 'button', 'Keep')
		const drafts = [
			`page "Drafts" ${fixtures.url('/confirm')}`,
			'# Drafts',
			`${remove} button "Delete"`,
			`${keep} button "Keep"`,
			'(2 of 2 elements)',
		].join('\n')
		expect(look).toBe(drafts)

		const plain = requireToolText(
			await tools.execute({ id: 'keep', name: 'click', arguments: { ref: keep } }),
		)
		expect(plain).toBe(`Clicked ${keep} button "Keep".\n\n${drafts}`)
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
		expect(accepted).toBe(`Accepted the confirm dialog "Delete the draft?".\n\n${drafts}`)
		expect(await page.evaluate('document.body.dataset.answer')).toBe('true')
		expect(tools.tool('dialog')).toBeUndefined()

		// The next action awaits the settled click and carries only its own receipt line.
		const after = requireToolText(
			await tools.execute({ id: 'again', name: 'click', arguments: { ref: keep } }),
		)
		expect(after).toBe(`Clicked ${keep} button "Keep".\n\n${drafts}`)
	})

	it('P20 names the beforeunload dialog in a link click receipt, and the accepted dialog commits the navigation (control: the link on a page without the handler navigates in one receipt)', async () => {
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
			requireToolText(
				await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the note' } }),
			),
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

		const idle = page.navigation.idle({ timeout: 10_000 })
		const accepted = requireToolText(
			await tools.execute({ id: 'dialog', name: 'dialog', arguments: { accept: true } }),
		)
		// The view this receipt carries races the committing navigation, so only its action line
		// is fixed.
		expect(accepted.split('\n', 1)[0]).toBe('Accepted the beforeunload dialog "".')
		await idle
		expect(page.url).toBe(fixtures.url('/beforeunload/next'))
		const destination = [
			`page "Next note" ${fixtures.url('/beforeunload/next')}`,
			'# Next note',
			'(0 of 0 elements)',
		].join('\n')
		expect(
			requireToolText(
				await tools.execute({ id: 'after', name: 'look', arguments: { what: 'the next note' } }),
			),
		).toBe(destination)

		const plain = await browser.create({ url: fixtures.url('/beforeunload/plain') })
		opened.push(plain)
		const controls = createToolManager()
		const control = createBrowserToolset(plain, { tools: controls })
		toolsets.push(control)
		await control.start()
		const link = requireOutlineReference(
			requireToolText(
				await controls.execute({ id: 'look', name: 'look', arguments: { what: 'the note' } }),
			),
			'link',
			'Next',
		)
		expect(
			requireToolText(
				await controls.execute({ id: 'click', name: 'click', arguments: { ref: link } }),
			),
		).toBe(`Clicked ${link} link "Next".\n\n${destination}`)
		expect(controls.tool('dialog')).toBeUndefined()
	})

	// Chromium 141 lists the `window.open` page with the opener's `openerId` and `attached: false`
	// and never sends `Target.attachedToTarget` for it on the opener's session, where
	// `BrowserPage` listens, so the `popup` event never fires and the view stays on the opener.
	it.fails('follows a popup the current page opens: tabs lists both, switch moves the cursor to the popup and its tools follow, and switch returns', async () => {
		const context = await browser.isolate()
		contexts.push(context)
		const page = await context.create({ url: fixtures.url('/popup') })
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools, context })
		toolsets.push(toolset)
		await toolset.start()
		const catalog = requireToolText(
			await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the catalog' } }),
		)
		const open = requireOutlineReference(catalog, 'button', 'Open details')
		const child = fixtures.url('/popup/child')

		const clicked = requireToolText(
			await tools.execute({ id: 'click', name: 'click', arguments: { ref: open } }),
		)
		expect(clicked).toContain(`Clicked ${open} button "Open details".`)
		await waitForCondition('the view moved to the popup', () => toolset.view.url === child, {
			budget: 5_000,
			interval: 20,
		})
		const tabs = requireToolText(
			await tools.execute({ id: 'tabs', name: 'tabs', arguments: { what: 'the open tabs' } }),
		)
		expect(
			tabs.endsWith(`t1 "Catalog" ${fixtures.url('/popup')}\nt2 "Details" ${child} (current)`),
		).toBe(true)
		expect(`${clicked}\n${tabs}`.split(`The view moved to a new tab: ${child}.`).length - 1).toBe(1)

		const moved = requireToolText(
			await tools.execute({ id: 'switch', name: 'switch', arguments: { tab: 't2' } }),
		)
		const details = requireToolText(
			await tools.execute({ id: 'details', name: 'look', arguments: { what: 'the details' } }),
		)
		expect(moved).toBe(`Switched to t2 ${child}.\n\n${details}`)
		const like = requireOutlineReference(details, 'button', 'Like')
		await tools.execute({ id: 'like', name: 'click', arguments: { ref: like } })
		const popup = context.pages().find((candidate) => candidate.url === child)
		expect(await popup?.evaluate('document.body.dataset.liked')).toBe('yes')

		const back = requireToolText(
			await tools.execute({ id: 'back', name: 'switch', arguments: { tab: 't1' } }),
		)
		expect(back).toBe(`Switched to t1 ${fixtures.url('/popup')}.\n\n${catalog}`)
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
			await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the catalog' } }),
		)
		const stay = requireOutlineReference(catalog, 'button', 'Stay')

		expect(
			requireToolText(
				await tools.execute({ id: 'click', name: 'click', arguments: { ref: stay } }),
			),
		).toBe(`Clicked ${stay} button "Stay".\n\n${catalog}`)
		expect(await page.evaluate('document.body.dataset.stayed')).toBe('yes')
		expect(
			requireToolText(
				await tools.execute({ id: 'tabs', name: 'tabs', arguments: { what: 'the open tabs' } }),
			),
		).toBe(`t1 "Catalog" ${fixtures.url('/popup')} (current)`)
		expect(toolset.view).toBe(page)
		expect(context.pages()).toStrictEqual([page])
	})

	it('moves the cursor between two tabs of one context with switch, and the page tools follow it', async () => {
		const context = await browser.isolate()
		contexts.push(context)
		const catalogPage = await context.create({ url: fixtures.url('/popup') })
		const detailsPage = await context.create({ url: fixtures.url('/popup/child') })
		const tools = createToolManager()
		const selected = createRecorder<[unknown]>()
		const toolset = createBrowserToolset(catalogPage, {
			tools,
			context,
			on: { select: selected.handler },
		})
		toolsets.push(toolset)
		await toolset.start()
		const catalog = requireToolText(
			await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the catalog' } }),
		)
		expect(
			requireToolText(
				await tools.execute({ id: 'tabs', name: 'tabs', arguments: { what: 'the open tabs' } }),
			),
		).toBe(
			`t1 "Catalog" ${fixtures.url('/popup')} (current)\nt2 "Details" ${fixtures.url('/popup/child')}`,
		)

		const moved = requireToolText(
			await tools.execute({ id: 'switch', name: 'switch', arguments: { tab: 't2' } }),
		)
		expect(toolset.view).toBe(detailsPage)
		const details = (await detailsPage.elements.outline()).text
		expect(moved).toBe(`Switched to t2 ${fixtures.url('/popup/child')}.\n\n${details}`)
		const like = requireOutlineReference(details, 'button', 'Like')
		expect(
			requireToolText(await tools.execute({ id: 'like', name: 'click', arguments: { ref: like } })),
		).toBe(`Clicked ${like} button "Like".\n\n${details}`)
		expect(await detailsPage.evaluate('document.body.dataset.liked')).toBe('yes')

		const back = requireToolText(
			await tools.execute({ id: 'back', name: 'switch', arguments: { tab: 't1' } }),
		)
		expect(back).toBe(`Switched to t1 ${fixtures.url('/popup')}.\n\n${catalog}`)
		expect(toolset.view).toBe(catalogPage)
		expect(selected.calls).toStrictEqual([[detailsPage], [catalogPage]])
	})

	// Pins the ordering of claim 22: the Enter that submits the framed form navigates the
	// `localhost` frame to `127.0.0.1`, another site and process, while its key-up is still to be
	// sent. The observed outcome is a receipt naming the submit, not a rejection; the view it
	// carries races the frame's move between processes, so the view is the outer page's outline
	// or a note that the capture failed or ran out of time.
	it('claim 22 returns a receipt naming the submit when type with submit navigates an out-of-process frame to another process', async () => {
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
			async () => (await page.elements.outline()).text.includes('textbox "Code"'),
			{ budget: 10_000, interval: 20 },
		)
		expect((await page.frames()).map((frame) => frame.url)).toContain(
			fixtures.url('/frame/field', 'localhost'),
		)
		const code = requireOutlineReference(
			requireToolText(
				await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the voucher' } }),
			),
			'textbox',
			'Code',
		)

		const result = await tools.execute({
			id: 'type',
			name: 'type',
			arguments: { ref: code, text: 'SPRING', submit: true },
		})
		const receipt = requireToolText(result)
		const split = receipt.indexOf('\n\n')
		expect(receipt.slice(0, split)).toBe(
			`Typed "SPRING" into ${code} textbox "Code" and submitted the form.`,
		)
		expect(receipt.slice(split + 2)).toSatisfy(
			(view: string) =>
				view.startsWith(`page "Voucher" ${fixtures.url('/frame/voucher')}\n`) ||
				/^\(The view could not be read[^\n]*; call look\.\)$/.test(view),
		)
		const done = fixtures.url('/frame/done?code=SPRING')
		await waitForCondition(
			'the framed form committed its cross-process navigation',
			async () => (await page.frames()).some((frame) => frame.url === done),
			{ budget: 10_000, interval: 20 },
		)
		expect(
			requireToolText(
				await tools.execute({ id: 'after', name: 'look', arguments: { what: 'the voucher' } }),
			),
		).toContain('# Voucher applied')
	})
})
