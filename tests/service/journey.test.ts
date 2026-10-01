import type { BrowserInterface } from '@src/server'
import type {
	BrowserContextInterface,
	BrowserPageInterface,
	BrowserToolsetInterface,
} from '@src/core'
import type {
	BrowserJourneyConnectionInterface,
	BrowserJourneyStageInterface,
	FixtureServerInterface,
} from '../setupServer.js'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isRecord, isString } from '@orkestrel/contract'
import { createTeardown, requireValue } from '@orkestrel/test'
import {
	BrowserContext,
	compileBrowserJourney,
	createBrowserRecorder,
	createBrowserReplay,
	createBrowserToolset,
	createCDPClient,
	locateBrowserTarget,
} from '@src/core'
import { createBrowser, createCDPTransport } from '@src/server'
import {
	createBrowserJourneyStage,
	createFixtureServer,
	createTempDirectory,
	reservePort,
} from '../setupServer.js'
import {
	maskBrowserReferences,
	requireSystemBrowser,
	SERVICE_BROWSER_ARGS,
} from '../setupService.js'
import {
	BrowserJourneyTransportRecorder,
	BROWSER_JOURNEY_GAP_CASE,
	BROWSER_JOURNEY_MODULE_CASES,
	BROWSER_JOURNEY_TARGET_HTML,
	BROWSER_JOURNEY_TARGET_LOG,
	createBrowserJourneyFixture,
	instrumentBrowserJourneyModule,
	openBrowserJourneyPage,
	readBrowserJourneyOutcome,
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

describe('compiled module equality', () => {
	const cleanup = createTeardown()
	let fixtures: FixtureServerInterface
	let context: BrowserContextInterface
	let stage: BrowserJourneyStageInterface
	let built: BrowserJourneyConnectionInterface

	// The generated module imports the built package through the stage's link and runs over a page
	// that package's own context opens, so the module's toolset and its page share one module
	// instance; the replay runs from the workspace source over a page of a second connection to the
	// same browser.
	beforeAll(async () => {
		fixtures = await createFixtureServer()
		cleanup.add(() => fixtures.destroy())
		const profile = createTempDirectory('journey-module-service-')
		cleanup.add(() => profile.destroy())
		const port = await reservePort()
		const browser = createBrowser({
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
		const client = createCDPClient({ transport: createCDPTransport({ url: endpoint }) })
		cleanup.add(() => client.close())
		await client.connect()
		context = new BrowserContext(client)
		cleanup.add(() => context.destroy())
		stage = createBrowserJourneyStage()
		cleanup.add(() => stage.destroy())
		built = await stage.connect(endpoint)
		cleanup.add(() => built.destroy())
	})
	afterEach(async () => {
		for (const page of [...context.pages(), ...built.context.pages()].reverse())
			if (!page.closed) await page.close()
	})
	afterAll(async () => {
		await cleanup.destroy()
	})

	it.each(BROWSER_JOURNEY_MODULE_CASES)(
		'runs the generated module of a $name to the page outcome and the receipts of its replay',
		async (scenario) => {
			const script = compileBrowserJourney(scenario.journey)
			const plain = stage.load(`${scenario.journey.name}.js`, script.source)
			const recorded = stage.load(
				`${scenario.journey.name}.recorded.js`,
				instrumentBrowserJourneyModule(script.source),
			)
			const outcomes: Array<readonly unknown[]> = []
			const failures: unknown[] = []
			for (const module of [plain, recorded]) {
				const page = await openBrowserJourneyPage(
					built.context,
					fixtures.url(scenario.route),
					scenario.markup,
				)
				failures.push(
					await module.execute(page, scenario.inputs).then(
						() => undefined,
						(error: unknown) => error,
					),
				)
				outcomes.push(await readBrowserJourneyOutcome(built.context.pages(), page, scenario.state))
			}
			const page = await openBrowserJourneyPage(
				context,
				fixtures.url(scenario.route),
				scenario.markup,
			)
			const toolset = createBrowserToolset(page)
			await toolset.start()
			const run = await createBrowserReplay(
				toolset,
				{ journey: scenario.journey },
				{ inputs: scenario.inputs },
			).execute()
			const replayed = await readBrowserJourneyOutcome(context.pages(), page, scenario.state)
			await toolset.destroy()

			expect({
				outcome: run.outcome,
				receipts: run.steps.map((step) => maskBrowserReferences(step.result)),
			}).toStrictEqual({
				outcome: 'complete',
				receipts: recorded.receipts().map(maskBrowserReferences),
			})
			expect(replayed).toStrictEqual(scenario.outcome)
			expect(outcomes).toStrictEqual([replayed, replayed])
			expect(failures).toStrictEqual([undefined, undefined])
			expect(script.gaps).toStrictEqual([])
		},
	)

	it('throws at the gap of a generated module with the page untouched, as the replay refuses the journey at preparation', async () => {
		const scenario = BROWSER_JOURNEY_GAP_CASE
		const script = compileBrowserJourney(scenario.journey)
		const url = fixtures.url(scenario.route)
		const module = stage.load(`${scenario.journey.name}.js`, script.source)
		const page = await openBrowserJourneyPage(built.context, url, scenario.markup)
		const failure = await module.execute(page, scenario.inputs).then(
			() => undefined,
			(error: unknown) => error,
		)
		const executed = await readBrowserJourneyOutcome(built.context.pages(), page, scenario.state)
		const fresh = await openBrowserJourneyPage(context, url, scenario.markup)
		const toolset = createBrowserToolset(fresh)
		await toolset.start()
		const refusal = await createBrowserReplay(
			toolset,
			{ journey: scenario.journey },
			{ inputs: scenario.inputs },
		)
			.execute()
			.then(
				() => undefined,
				(error: unknown) => error,
			)
		const refused = await readBrowserJourneyOutcome(context.pages(), fresh, scenario.state)
		await toolset.destroy()
		const control = stage.load(
			`${scenario.journey.name}.control.js`,
			script.source.replace(/^\t\tthrow .*\n/mu, ''),
		)
		const clicked = await openBrowserJourneyPage(built.context, url, scenario.markup)
		await control.execute(clicked, scenario.inputs)

		expect(refused).toStrictEqual(scenario.outcome)
		expect(executed).toStrictEqual(refused)
		expect(script.gaps).toStrictEqual(['s2'])
		expect(failure).toMatchObject({
			message: 's2: the element is in a child frame; handle it here',
		})
		expect(refusal).toMatchObject({ code: 'BROWSER_JOURNEY_GAP' })
		expect(
			await readBrowserJourneyOutcome(built.context.pages(), clicked, scenario.state),
		).toStrictEqual([{ clicks: 1, saved: 'yes' }])
	})

	it('type-checks the TypeScript module of every journey against the built declarations and refuses a misspelled input', () => {
		const sources = Object.fromEntries(
			[...BROWSER_JOURNEY_MODULE_CASES, BROWSER_JOURNEY_GAP_CASE].map((scenario) => [
				`${scenario.journey.name}.ts`,
				compileBrowserJourney(scenario.journey, { language: 'typescript' }).source,
			]),
		)
		const misspelled = requireValue(sources['place-order.ts']).replace('inputs.name', 'inputs.nmae')

		expect(Object.keys(sources)).toStrictEqual([
			'place-order.ts',
			'choose-destination.ts',
			'book-delivery.ts',
			'delete-draft.ts',
			'like-details.ts',
			'save-draft.ts',
		])
		expect(stage.check(sources)).toStrictEqual([])
		expect(stage.check({ 'control.ts': misspelled })).toStrictEqual([
			expect.stringMatching(
				/^control\.ts\(\d+,\d+\): error TS2339: Property 'nmae' does not exist/u,
			),
		])
	})
})
