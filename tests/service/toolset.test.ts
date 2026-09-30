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
 * One case is an expected failure: Chromium never attaches a page that `window.open` creates to
 * its opener's session, so the page's `popup` event never fires. Its block establishes every
 * precondition, the popup target included, before the one inverted assertion; the cursor
 * mechanism is proven between two tabs of one context.
 */

import type { BrowserInterface } from '@src/server'
import type {
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
	createTempDirectory,
	FIXTURE_CHECKOUT_CODE,
	reservePort,
} from '../setupServer.js'
import {
	extractOutlineRows,
	matchesToolReceipt,
	requireOutlineReference,
	requireSystemBrowser,
	requireToolText,
	SERVICE_BROWSER_ARGS,
	SERVICE_EDITABLE_HTML,
} from '../setupService.js'

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
			`page "Order placed" ${placed}`,
			'# Order placed',
			'Delivery booked for Grace Hopper at Standard speed.',
			'(0 of 0 elements)',
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
			async () => page.url === placed && (await page.elements.outline()).text === result,
			{ budget: 10_000, interval: 20 },
		)

		const read = requireToolText(
			await tools.execute({ id: 'read', name: 'read', arguments: { what: 'the confirmation' } }),
		)
		expect(read).toBe('# Order placed\n\nDelivery booked for Grace Hopper at Standard speed.')

		expect(
			[look, click, typed, read].filter((receipt) => receipt.length > BROWSER_TOOL_LIMIT),
		).toStrictEqual([])
	})

	it('returns the cart view in the receipt of a click whose POST form the server answers with 303, and the same page with the handled status for a form whose submit handler prevents the submission', async () => {
		const page = await browser.create({ url: fixtures.url('/shop') })
		opened.push(page)
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()
		const look = requireToolText(
			await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the tray' } }),
		)
		const add = requireOutlineReference(look, 'button', 'Add to cart')
		const hold = requireOutlineReference(look, 'button', 'Save for later')

		const held = requireToolText(
			await tools.execute({ id: 'hold', name: 'click', arguments: { ref: hold } }),
		)
		expect(held).toBe(
			`Clicked ${hold} button "Save for later"; the page handled the submission without navigating.\n\n${look}`,
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
				`page "Cart" ${fixtures.url('/shop/cart')}`,
				'# Cart',
				'Your cart holds the Cedar Tea Tray.',
				'(0 of 0 elements)',
			].join('\n'),
		)
	})

	it('names the page handling of a type with submit whose submission the page script prevents and posts, returning the page before its confirmation, which a following wait finds (control: a form that navigates keeps the destination view)', async () => {
		const page = await browser.create({ url: fixtures.url('/checkout') })
		opened.push(page)
		const tools = createToolManager()
		const toolset = createBrowserToolset(page, { tools })
		toolsets.push(toolset)
		await toolset.start()
		const look = requireToolText(
			await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the checkout' } }),
		)
		const name = requireOutlineReference(look, 'textbox', 'Name')
		const recipient = requireOutlineReference(look, 'textbox', 'Gift name')
		const confirmation = `Order ${FIXTURE_CHECKOUT_CODE} placed for Ada Lovelace.`

		const typed = requireToolText(
			await tools.execute({
				id: 'order',
				name: 'type',
				arguments: { ref: name, text: 'Ada Lovelace', submit: true },
			}),
		)
		expect(typed.split('\n', 1)[0]).toBe(
			`Typed "Ada Lovelace" into ${name} textbox "Name" and submitted the form; the page handled the submission without navigating.`,
		)
		expect(typed).toContain(`\n\npage "Checkout" ${fixtures.url('/checkout')}\n`)
		expect(typed).toContain(`${name} textbox "Name" value="Ada Lovelace"`)
		expect(typed).not.toContain(FIXTURE_CHECKOUT_CODE)
		expect(page.url).toBe(fixtures.url('/checkout'))

		expect(
			requireToolText(
				await tools.execute({ id: 'wait', name: 'wait', arguments: { text: confirmation } }),
			),
		).toBe(`${JSON.stringify(confirmation)} is on the page.`)

		const gift = requireToolText(
			await tools.execute({
				id: 'gift',
				name: 'type',
				arguments: { ref: recipient, text: 'Grace Hopper', submit: true },
			}),
		)
		const placed = fixtures.url('/form/placed?speed=Standard&name=Grace+Hopper')
		const view = [
			`page "Order placed" ${placed}`,
			'# Order placed',
			'Delivery booked for Grace Hopper at Standard speed.',
			'(0 of 0 elements)',
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
		const look = requireToolText(
			await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the notes' } }),
		)
		const notes = requireOutlineReference(look, 'textbox', 'Notes')
		const bold = requireOutlineReference(look, 'button', 'Bold')
		const coupon = requireOutlineReference(look, 'button', 'Coupon')
		expect(look).toContain(
			[
				'Plain notes',
				`${notes} textbox "Notes"`,
				'Draft',
				`${bold} button "Bold"`,
				`${coupon} button "Coupon"`,
				'(7 of 7 elements)',
			].join('\n'),
		)
		expect(extractOutlineRows(look).map((row) => row.name)).not.toContain('Plain notes')

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
				plain.url === fixtures.url('/beforeunload/next') &&
				(await plain.elements.outline()).text === destination,
			{ budget: 10_000, interval: 20 },
		)
	})

	describe('a popup that window.open creates from a trusted click', () => {
		const suite = createTeardown()
		let toolset: BrowserToolsetInterface
		let child: string

		// Establishes, outside the inverted assertion, every step before the popup event: the
		// context, the navigation, the toolset, the reference, the activation click, and a second
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
				await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the catalog' } }),
			)
			const open = requireOutlineReference(catalog, 'button', 'Open details')
			child = fixtures.url('/popup/child')
			const clicked = requireToolText(
				await tools.execute({ id: 'click', name: 'click', arguments: { ref: open } }),
			)
			if (
				!matchesToolReceipt(clicked, {
					action: `Clicked ${open} button "Open details"`,
					view: catalog,
				})
			)
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

		// `BrowserPage` builds a popup only from `Target.attachedToTarget` of type `page` on the
		// opener's session, and Chromium 141 sends none for a `window.open` page
		// (`tmp/codex/u11b-mutations/popup-trace.txt`), so the `popup` event never fires and the
		// cursor stays on the opener.
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
			await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the catalog' } }),
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
			requireToolText(
				await tools.execute({ id: 'tabs', name: 'tabs', arguments: { what: 'the open tabs' } }),
			),
		).toBe(`t1 "Catalog" ${fixtures.url('/popup')} (current)`)
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
				await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the catalog' } }),
			)
		})

		it('moves the cursor between the tabs with switch, and the page tools follow it', async () => {
			const selected = createRecorder<[unknown]>()
			toolset.emitter.on('select', selected.handler)
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
					await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the catalog' } }),
				),
			).toBe(
				`The tab ${closed} closed; the view returned to ${fixtures.url('/popup')}.\n\n${catalog}`,
			)
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
			async () => (await page.elements.outline()).text.includes('textbox "Code"'),
			{ budget: 10_000, interval: 20 },
		)
		expect((await page.frames()).map((frame) => frame.url)).toContain(
			fixtures.url('/frame/field', 'localhost'),
		)
		const look = requireToolText(
			await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the voucher' } }),
		)
		const frame = requireOutlineReference(look, 'Iframe', 'Voucher form')
		const code = requireOutlineReference(look, 'textbox', 'Code')

		const receipt = requireToolText(
			await tools.execute({
				id: 'type',
				name: 'type',
				arguments: { ref: code, text: 'SPRING', submit: true },
			}),
		)
		const applied = [
			`page "Voucher" ${fixtures.url('/frame/voucher')}`,
			'# Voucher',
			`${frame} Iframe "Voucher form"`,
			'# Voucher applied',
			'Received key Enter',
			'(1 of 1 elements)',
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
			async () => (await page.elements.outline()).text === applied,
			{ budget: 10_000, interval: 20 },
		)
		expect(
			requireToolText(
				await tools.execute({ id: 'after', name: 'look', arguments: { what: 'the voucher' } }),
			),
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
			async () => (await page.elements.outline()).text.includes('textbox "Code"'),
			{ budget: 10_000, interval: 20 },
		)
		const look = requireToolText(
			await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the voucher' } }),
		)
		const frame = requireOutlineReference(look, 'Iframe', 'Voucher form')
		const code = requireOutlineReference(look, 'textbox', 'Code')

		const receipt = requireToolText(
			await tools.execute({
				id: 'type',
				name: 'type',
				arguments: { ref: code, text: 'SPRING', submit: true },
			}),
		)
		const applied = [
			`page "Local voucher" ${fixtures.url('/frame/local')}`,
			'# Local voucher',
			`${frame} Iframe "Voucher form"`,
			'# Voucher applied',
			'Received key Enter',
			'(1 of 1 elements)',
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
			async () => (await page.elements.outline()).text.includes('textbox "Coupon"'),
			{ budget: 10_000, interval: 20 },
		)
		const inner = (await page.frames()).find(
			(candidate) => candidate.url === fixtures.url('/frame/inner'),
		)
		const middle = (await page.frames()).find(
			(candidate) => candidate.url === fixtures.url('/frame/middle', 'localhost'),
		)
		expect(inner?.parent).toBe(requireValue(middle).id)
		const look = requireToolText(
			await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the coupon' } }),
		)
		const coupon = requireOutlineReference(look, 'textbox', 'Coupon')

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
		const look = requireToolText(
			await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the search' } }),
		)
		const find = requireOutlineReference(look, 'button', 'Find')
		const started = performance.now()
		const receipt = requireToolText(
			await tools.execute({ id: 'find', name: 'click', arguments: { ref: find } }),
		)
		const elapsed = performance.now() - started
		expect(receipt).toBe(
			[
				`Clicked ${find} button "Find".`,
				'',
				`page "Search" ${fixtures.url('/search?q=tray#found')}`,
				'# Search',
				`${find} button "Find"`,
				'(1 of 1 elements)',
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
					await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the form' } }),
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
				`page "Order placed" ${placed}`,
				'# Order placed',
				'Delivery booked for Grace Hopper at Standard speed.',
				'(0 of 0 elements)',
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
				await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the drafts' } }),
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
					await tools.execute({ id: 'look', name: 'look', arguments: { what: 'the note' } }),
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
					`page "Next note" ${fixtures.url('/beforeunload/next')}`,
					'# Next note',
					'(0 of 0 elements)',
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
			const details = (await second.elements.outline()).text

			const started = performance.now()
			const moved = requireToolText(
				await tools.execute({ id: 'switch', name: 'switch', arguments: { tab: 't2' } }),
			)
			const elapsed = performance.now() - started
			expect(moved).toBe(`Switched to t2 ${fixtures.url('/popup/child')}.\n\n${details}`)
			expect(elapsed).toBeLessThan(BROWSER_TOOL_TIMEOUT_MS)
		})
	})
})
