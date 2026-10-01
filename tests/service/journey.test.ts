import type { BrowserInterface } from '@src/server'
import type {
	BrowserContextInterface,
	BrowserPageInterface,
	BrowserToolsetInterface,
} from '@src/core'
import type { FixtureServerInterface } from '../setupServer.js'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isRecord, isString } from '@orkestrel/contract'
import { createTeardown } from '@orkestrel/test'
import {
	BrowserContext,
	createBrowserRecorder,
	createBrowserReplay,
	createBrowserToolset,
	createCDPClient,
	locateBrowserTarget,
} from '@src/core'
import { createBrowser, createCDPTransport } from '@src/server'
import { createFixtureServer, createTempDirectory, reservePort } from '../setupServer.js'
import { requireSystemBrowser, SERVICE_BROWSER_ARGS } from '../setupService.js'
import {
	BrowserJourneyTransportRecorder,
	BROWSER_JOURNEY_TARGET_HTML,
	BROWSER_JOURNEY_TARGET_LOG,
	createBrowserJourneyFixture,
} from '../setup.js'

describe('journey semantic replay', () => {
	const cleanup = createTeardown()
	let browser: BrowserInterface
	let fixtures: FixtureServerInterface
	let context: BrowserContextInterface
	let page: BrowserPageInterface
	let toolset: BrowserToolsetInterface
	let transport: BrowserJourneyTransportRecorder

	beforeAll(async () => {
		fixtures = await createFixtureServer()
		cleanup.add(() => fixtures.destroy())
		const profile = createTempDirectory('journey-service-')
		cleanup.add(() => profile.destroy())
		const port = await reservePort()
		browser = createBrowser({
			executable: requireSystemBrowser().executable,
			headless: true,
			profile: profile.path,
			args: SERVICE_BROWSER_ARGS,
			cdp: { port },
			timeout: 20_000,
		})
		cleanup.add(() => browser.destroy())
		await browser.connect()
		const version: unknown = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
		const endpoint = isRecord(version) ? version['webSocketDebuggerUrl'] : undefined
		if (!isString(endpoint)) throw new Error('Chromium reported no debugger URL')
		transport = new BrowserJourneyTransportRecorder(createCDPTransport({ url: endpoint }))
		const client = createCDPClient({ transport })
		cleanup.add(() => client.close())
		await client.connect()
		context = new BrowserContext(client)
		cleanup.add(() => context.destroy())
	})
	beforeEach(async () => {
		page = await context.create({ url: fixtures.url('/form') })
		toolset = createBrowserToolset(page)
		await toolset.start()
	})
	afterEach(async () => {
		await toolset.destroy()
		await page.close()
	})
	afterAll(async () => {
		await cleanup.destroy()
	})

	describe('claim 3: changed markup and duplicate refusal', () => {
		it('replays by exact name after ids, classes, and order change, then refuses duplicates without input', async () => {
			await page.evaluate(
				`(() => { document.body.innerHTML = ${JSON.stringify(BROWSER_JOURNEY_TARGET_HTML.record)}; ${BROWSER_JOURNEY_TARGET_LOG} })()`,
			)
			const recorder = createBrowserRecorder(toolset)
			try {
				await recorder.start()
				const target = await locateBrowserTarget(page, { role: 'button', name: 'Delete' })
				expect(
					(
						await toolset.perform({
							id: 'record',
							name: 'click',
							arguments: { ref: target.reference },
						})
					).action?.outcome,
				).toBe('done')
				await recorder.stop()
				const journey = recorder.journey({ name: 'delete-entry', description: 'Delete one entry' })
				expect(journey.steps[0]?.target).toMatchObject({
					role: 'button',
					name: 'Delete',
					reference: target.reference,
				})
				await page.evaluate(
					`(() => { document.body.innerHTML = ${JSON.stringify(BROWSER_JOURNEY_TARGET_HTML.changed)}; ${BROWSER_JOURNEY_TARGET_LOG} })()`,
				)
				const changed = await createBrowserReplay(toolset, { journey }).execute()
				expect(changed.outcome).toBe('complete')
				expect(await page.evaluate('JSON.parse(document.body.dataset.journeyClicks)')).toEqual([
					{ id: 'k1', trusted: true },
				])
				await page.evaluate(
					`(() => { document.body.innerHTML = ${JSON.stringify(BROWSER_JOURNEY_TARGET_HTML.duplicate)}; ${BROWSER_JOURNEY_TARGET_LOG} })()`,
				)
				transport.clear()
				const duplicate = await createBrowserReplay(toolset, { journey }).execute()
				expect(duplicate.outcome).toBe('stopped')
				expect(duplicate.steps[0]?.outcome).toBe('refused')
				expect(duplicate.steps[0]?.result).toContain('2 elements carry')
				expect(
					transport.sent.filter((frame) => frame.includes('Input.dispatchMouseEvent')),
				).toEqual([])
				expect(await page.evaluate('JSON.parse(document.body.dataset.journeyClicks)')).toEqual([])
				await expect(
					locateBrowserTarget(page, { role: 'button', name: 'Delete' }),
				).rejects.toMatchObject({ code: 'BROWSER_JOURNEY_AMBIGUOUS' })
				const controls = await page.elements.find({ css: '#k1' })
				await controls[0]?.click()
				expect(transport.sent.some((frame) => frame.includes('Input.dispatchMouseEvent'))).toBe(
					true,
				)
				expect(await page.evaluate('JSON.parse(document.body.dataset.journeyClicks)')).toEqual([
					{ id: 'k1', trusted: true },
				])
			} finally {
				await recorder.destroy()
			}
		})
	})

	describe('claim 4: CSS evidence never resolves a target', () => {
		it('refuses an absent semantic name even when CSS uniquely matches a different control', async () => {
			await page.evaluate(
				`(() => { document.body.innerHTML = ${JSON.stringify(BROWSER_JOURNEY_TARGET_HTML.css)}; ${BROWSER_JOURNEY_TARGET_LOG} })()`,
			)
			expect(await page.elements.find({ css: '#cancel' })).toHaveLength(1)
			const target = { role: 'button', name: 'Submit order', css: '#cancel', reference: 'e1' }
			const journey = createBrowserJourneyFixture([{ action: 'click', arguments: {}, target }])
			transport.clear()
			await expect(locateBrowserTarget(page, target)).rejects.toMatchObject({
				code: 'BROWSER_JOURNEY_TARGET',
			})
			const run = await createBrowserReplay(toolset, { journey }).execute()
			expect(run.outcome).toBe('stopped')
			expect(run.steps[0]?.result).toContain('no element carries')
			expect(transport.sent.filter((frame) => frame.includes('Input.dispatchMouseEvent'))).toEqual(
				[],
			)
			expect(transport.sent.filter((frame) => frame.includes('DOM.querySelectorAll'))).toEqual([])
			expect(await page.evaluate('JSON.parse(document.body.dataset.journeyClicks)')).toEqual([])
			await (await locateBrowserTarget(page, { role: 'button', name: 'Cancel' })).click()
			expect(transport.sent.some((frame) => frame.includes('Input.dispatchMouseEvent'))).toBe(true)
			expect(await page.evaluate('JSON.parse(document.body.dataset.journeyClicks)')).toEqual([
				{ id: 'cancel', trusted: true },
			])
		})
	})
})
