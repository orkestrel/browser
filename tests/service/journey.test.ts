import type { BrowserInterface } from '@src/server'
import type {
	BrowserAction,
	BrowserContextInterface,
	BrowserJourneyStoreInterface,
	BrowserPageInterface,
	BrowserToolSourceEventMap,
	BrowserToolsetInterface,
	BrowserToolsetResult,
} from '@src/core'
import type {
	BrowserJourneyConnectionInterface,
	BrowserJourneyStageInterface,
	FixtureServerInterface,
} from '../setupServer.js'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isRecord, isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { createRecorder, createTeardown, requireValue, waitForCondition } from '@orkestrel/test'
import { createTool, createToolManager } from '@orkestrel/tool'
import {
	BrowserContext,
	compileBrowserJourney,
	createBrowserRecorder,
	createBrowserReplay,
	createBrowserToolset,
	createCDPClient,
	locateBrowserTarget,
	renderBrowserRun,
} from '@src/core'
import {
	createBrowser,
	createCDPTransport,
	createFileBrowserJourneyStore,
	createFileBrowserRunStore,
} from '@src/server'
import {
	createBrowserJourneyStage,
	createFixtureServer,
	createTempDirectory,
	requireDocumentBundle,
	reservePort,
} from '../setupServer.js'
import {
	maskBrowserReferences,
	requireDocumentToolset,
	requireOutlineReference,
	requireSystemBrowser,
	requireToolText,
	SERVICE_BROWSER_ARGS,
} from '../setupService.js'
import {
	BrowserJourneyTransportRecorder,
	BROWSER_JOURNEY_ABORT_JOURNEY,
	BROWSER_JOURNEY_EVENT_COUNTER,
	BROWSER_JOURNEY_GAP_CASE,
	BROWSER_JOURNEY_HOLD_JOURNEY,
	BROWSER_JOURNEY_MODULE_CASES,
	BROWSER_JOURNEY_PASSWORD_HTML,
	BROWSER_JOURNEY_PREFIX_JOURNEY,
	BROWSER_JOURNEY_PREPARATION_CASES,
	BROWSER_JOURNEY_PREPARED_JOURNEY,
	BROWSER_JOURNEY_PRESS_JOURNEY,
	BROWSER_JOURNEY_SECRET,
	BROWSER_JOURNEY_SERVICE_CASES,
	BROWSER_JOURNEY_SLOW_HTML,
	BROWSER_JOURNEY_TARGET_HTML,
	BROWSER_JOURNEY_TARGET_LOG,
	BROWSER_JOURNEY_TIMEOUT_CONTROL,
	BROWSER_JOURNEY_TIMEOUT_JOURNEY,
	createBrowserJourneyFixture,
	createBrowserJourneyServiceJourney,
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
				const target = await locateBrowserTarget(
					page,
					{ role: 'button', name: 'Delete' },
					{ id: 'record' },
				)
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
					locateBrowserTarget(page, { role: 'button', name: 'Delete' }, { id: 's1' }),
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
			await expect(locateBrowserTarget(page, target, { id: 's1' })).rejects.toMatchObject({
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
			await (
				await locateBrowserTarget(page, { role: 'button', name: 'Cancel' }, { id: 's1' })
			).click()
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

	it('refuses a generated module with a gap before its first step, leaving the click log empty as the replay does at preparation', async () => {
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
			instrumentBrowserJourneyModule(script.source.replace(/^\t+throw .*\n/mu, '')),
		)
		const clicked = await openBrowserJourneyPage(built.context, url, scenario.markup)
		await control.execute(clicked, scenario.inputs)

		expect(control.receipts(), 'the step calls the module emits around its gap').toHaveLength(2)
		expect(refused).toStrictEqual(scenario.outcome)
		expect(executed).toStrictEqual(refused)
		expect(script.gaps).toStrictEqual(['s2'])
		expect(failure).toMatchObject({
			message: 's2: the element is in a child frame; handle it here',
		})
		expect(refusal).toMatchObject({ code: 'BROWSER_JOURNEY_GAP' })
		expect(
			await readBrowserJourneyOutcome(built.context.pages(), clicked, scenario.state),
		).toStrictEqual([{ clicks: 'save:true submit:true', saved: 'yes' }])
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

describe('journey replay coordination, preparation, tools, and secrecy', () => {
	const cleanup = createTeardown()
	const pages: BrowserPageInterface[] = []
	const toolsets: BrowserToolsetInterface[] = []
	let fixtures: FixtureServerInterface
	let context: BrowserContextInterface
	let transport: BrowserJourneyTransportRecorder

	beforeAll(async () => {
		fixtures = await createFixtureServer()
		cleanup.add(() => fixtures.destroy())
		const profile = createTempDirectory('journey-claims-service-')
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
		transport = new BrowserJourneyTransportRecorder(createCDPTransport({ url: endpoint }))
		const client = createCDPClient({ transport })
		cleanup.add(() => client.close())
		await client.connect()
		context = new BrowserContext(client)
		cleanup.add(() => context.destroy())
	})
	afterEach(async () => {
		for (const toolset of toolsets.splice(0)) await toolset.destroy()
		for (const page of pages.splice(0)) if (!page.closed) await page.close()
	})
	afterAll(async () => {
		await cleanup.destroy()
	})

	describe('claim 6: a replay hold admits only its own actions', () => {
		it('refuses a foreign click, dialog, and adopted page tool while look, read, tabs, and wait pass, after an action admitted before the hold completes first', async () => {
			const page = await context.create({ url: fixtures.url('/confirm') })
			pages.push(page)
			const invoked = createRecorder<[]>()
			const source = createToolManager()
			source.add(createTool({ name: 'checkout', execute: invoked.handler }))
			const toolset = createBrowserToolset(page, {
				context,
				source: {
					adopt: async () => source.tools(),
					emitter: new Emitter<BrowserToolSourceEventMap>(),
				},
			})
			toolsets.push(toolset)
			await toolset.start()
			const events: string[] = []
			const dialogs: Array<Promise<BrowserToolsetResult>> = []
			toolset.emitter.on('hold', (name) => events.push(`hold ${name}`))
			toolset.emitter.on('release', (name) => events.push(`release ${name}`))
			toolset.emitter.on('action', (action) => {
				events.push(`${action.action} ${action.outcome}`)
				// The dialog is open only between the replay's interrupted click and its dialog step, so
				// the foreign answer is sent from the action event itself.
				if (action.outcome === 'interrupted')
					dialogs.push(
						toolset.perform({ id: 'foreign', name: 'dialog', arguments: { accept: false } }),
					)
			})
			const keep = await locateBrowserTarget(
				page,
				{ role: 'button', name: 'Keep' },
				{ id: 'early' },
			)
			const reached = Promise.withResolvers<void>()
			const replay = createBrowserReplay(
				toolset,
				{ journey: BROWSER_JOURNEY_HOLD_JOURNEY },
				{
					on: {
						step: (step) => {
							if (step.id === 's2') reached.resolve()
						},
					},
				},
			)
			const early = toolset.perform({
				id: 'early',
				name: 'click',
				arguments: { ref: keep.reference },
			})
			const running = replay.execute()
			await reached.promise
			const refused = [
				await toolset.tools.execute({
					id: 'click',
					name: 'click',
					arguments: { ref: keep.reference },
				}),
				await toolset.tools.execute({
					id: 'checkout',
					name: 'checkout',
					arguments: { what: 'the cart' },
				}),
			]
			const passed = [
				await toolset.tools.execute({ id: 'look', name: 'look', arguments: { what: 'drafts' } }),
				await toolset.tools.execute({ id: 'read', name: 'read', arguments: { what: 'drafts' } }),
				await toolset.tools.execute({ id: 'tabs', name: 'tabs', arguments: { what: 'tabs' } }),
				await toolset.tools.execute({ id: 'wait', name: 'wait', arguments: { text: 'Drafts' } }),
			]
			await page.evaluate(
				`document.querySelector('main').insertAdjacentHTML('beforeend', '<p>Draft deleted</p>')`,
			)
			const run = await running
			const busy = 'The toolset is replaying delete-draft until it finishes; call look.'

			expect((await early).action?.outcome).toBe('done')
			expect(events.slice(0, 5)).toEqual([
				'click done',
				'hold delete-draft',
				'click interrupted',
				'dialog refused',
				'dialog done',
			])
			expect(events.at(-1)).toBe('release delete-draft')
			expect(await Promise.all(dialogs)).toMatchObject([
				{ result: { success: false, error: busy }, action: { outcome: 'refused' } },
			])
			expect(refused).toMatchObject([
				{ success: false, error: busy },
				{ success: false, error: busy },
			])
			expect(passed.map((result) => result.success)).toEqual([true, true, true, true])
			expect(requireToolText(passed[3])).toBe('"Drafts" is on the page.')
			expect(invoked.count).toBe(0)
			expect(run.outcome).toBe('complete')
			expect(run.steps.map((step) => step.outcome)).toEqual(['interrupted', 'done', 'done'])
			expect(await page.evaluate('document.body.dataset.answer')).toBe('true')
			expect(await page.evaluate('document.body.dataset.kept')).toBe('1')
		})

		it('releases the hold when an abort lands during a held input and runs no following action', async () => {
			const page = await context.create({ url: fixtures.url('/confirm') })
			pages.push(page)
			await page.evaluate(
				`document.querySelector('main').insertAdjacentHTML('beforeend', ${JSON.stringify(BROWSER_JOURNEY_SLOW_HTML)})`,
			)
			const toolset = createBrowserToolset(page)
			toolsets.push(toolset)
			await toolset.start()
			const released = createRecorder<[name: string]>()
			toolset.emitter.on('release', released.handler)
			const controller = new AbortController()
			transport.clear()
			const running = createBrowserReplay(toolset, {
				journey: BROWSER_JOURNEY_ABORT_JOURNEY,
			}).execute({ signal: controller.signal })
			await waitForCondition(
				'the replay sent the release of its slow click',
				() => transport.sent.some((frame) => frame.includes('"mouseReleased"')),
				{ budget: 10_000, interval: 5 },
			)
			controller.abort()
			const run = await running

			expect(run.outcome).toBe('aborted')
			expect(run.steps.map((step) => step.id)).toEqual(['s1'])
			expect(released.calls).toEqual([['keep-draft']])
			expect(await page.evaluate('document.body.dataset.slow')).toBe('done')
			expect(await page.evaluate('document.body.dataset.kept ?? "none"')).toBe('none')
			const keep = await locateBrowserTarget(
				page,
				{ role: 'button', name: 'Keep' },
				{ id: 'after' },
			)
			const after = await toolset.perform({
				id: 'after',
				name: 'click',
				arguments: { ref: keep.reference },
			})
			expect(after.action?.outcome).toBe('done')
			expect(await page.evaluate('document.body.dataset.kept')).toBe('1')
		})
	})

	describe('claim 7: a wait that times out stops the run', () => {
		it('stops at a wait whose text never appears with outcome timeout and the direct receipt, and sends no following input', async () => {
			const page = await context.create({ url: fixtures.url('/form') })
			pages.push(page)
			const toolset = createBrowserToolset(page)
			toolsets.push(toolset)
			await toolset.start()
			const direct = requireToolText(
				await toolset.tools.execute({
					id: 'direct',
					name: 'wait',
					arguments: { text: 'Order shipped' },
				}),
			)
			const run = await createBrowserReplay(toolset, {
				journey: BROWSER_JOURNEY_TIMEOUT_JOURNEY,
			}).execute()
			const control = await context.create({ url: fixtures.url('/form') })
			pages.push(control)
			const controlled = createBrowserToolset(control)
			toolsets.push(controlled)
			await controlled.start()
			const completed = await createBrowserReplay(controlled, {
				journey: BROWSER_JOURNEY_TIMEOUT_CONTROL,
			}).execute()

			expect(direct).toBe('"Order shipped" did not appear within 5 s.')
			expect(run.outcome).toBe('stopped')
			expect(run.steps.map((step) => [step.id, step.outcome])).toEqual([
				['s1', 'done'],
				['s2', 'timeout'],
			])
			expect(run.steps[1]?.result).toBe(direct)
			expect(renderBrowserRun(run).split('\n')[0]).toBe(
				'Replay of review-draft stopped at s2 of 3: "Order shipped" did not appear within 5 s.',
			)
			expect(await page.evaluate('document.body.dataset.clicks')).toBe('save:true')
			expect(await page.evaluate('location.pathname')).toBe('/form')
			expect(completed.outcome).toBe('complete')
			expect(await control.evaluate('document.body.dataset.clicks')).toBe('save:true review:true')
			expect(await control.evaluate('location.pathname')).toBe('/form/review')
		})
	})

	describe('claim 8: preparation refuses before any side effect', () => {
		it.each(BROWSER_JOURNEY_PREPARATION_CASES)(
			'refuses $name with the page event counter at zero and no run stored',
			async (scenario) => {
				const root = createTempDirectory('journey-runs-service-')
				cleanup.add(() => root.destroy())
				const runs = createFileBrowserRunStore({ root: root.path })
				const page = await context.create({ url: fixtures.url('/form') })
				pages.push(page)
				await page.evaluate(BROWSER_JOURNEY_EVENT_COUNTER)
				const toolset = createBrowserToolset(page)
				toolsets.push(toolset)
				await toolset.start()
				transport.clear()
				const refusal = await createBrowserReplay(
					toolset,
					{ journey: scenario.journey },
					{ inputs: scenario.inputs, runs },
				)
					.execute()
					.then(
						() => undefined,
						(error: unknown) => error,
					)

				expect(refusal).toMatchObject({ code: scenario.code })
				expect(await page.evaluate('document.body.dataset.events')).toBe('0')
				expect(transport.sent.filter((frame) => frame.includes('Input.dispatch'))).toEqual([])
				expect(await runs.list(scenario.journey.name)).toEqual({
					entries: [],
					truncated: false,
					faults: [],
				})
				expect(root.names()).toEqual([])
			},
		)

		it('stores the run of the same journey given its input, and the counter moves (control)', async () => {
			const root = createTempDirectory('journey-runs-service-')
			cleanup.add(() => root.destroy())
			const runs = createFileBrowserRunStore({ root: root.path })
			const page = await context.create({ url: fixtures.url('/form') })
			pages.push(page)
			await page.evaluate(BROWSER_JOURNEY_EVENT_COUNTER)
			const toolset = createBrowserToolset(page)
			toolsets.push(toolset)
			await toolset.start()
			const run = await createBrowserReplay(
				toolset,
				{ journey: BROWSER_JOURNEY_PREPARED_JOURNEY },
				{ inputs: { name: 'Grace' }, runs },
			).execute()

			expect(run.outcome).toBe('complete')
			expect(Number(await page.evaluate('document.body.dataset.events'))).toBeGreaterThan(0)
			expect((await runs.list('name-draft')).entries.map((entry) => entry.id)).toEqual([run.id])
		})

		it('refuses a press in the DOM placement before any event, and keeps the executed prefix of a live refusal at s3', async () => {
			requireDocumentBundle()
			const page = await context.create({ url: fixtures.url('/document') })
			pages.push(page)
			await requireDocumentToolset(page)
			await page.evaluate(BROWSER_JOURNEY_EVENT_COUNTER)
			const refused = await page.evaluate(
				`import('/dist/src/core/index.js').then(async ({ createBrowserReplay, createMemoryBrowserRunStore }) => {
					const runs = createMemoryBrowserRunStore()
					const refusal = await createBrowserReplay(documentToolset, { journey: ${JSON.stringify(BROWSER_JOURNEY_PRESS_JOURNEY)} }, { runs }).execute().then(() => undefined, (error) => ({ code: error.code, message: error.message }))
					return { refusal, events: document.body.dataset.events, stored: (await runs.list('wrap-press')).entries.length }
				})`,
			)
			const live = await page.evaluate(
				`import('/dist/src/core/index.js').then(async ({ createBrowserReplay, createMemoryBrowserRunStore }) => {
					const runs = createMemoryBrowserRunStore()
					const run = await createBrowserReplay(documentToolset, { journey: ${JSON.stringify(BROWSER_JOURNEY_PREFIX_JOURNEY)} }, { runs }).execute()
					return {
						outcome: run.outcome,
						steps: run.steps.map((step) => [step.id, step.outcome]),
						result: run.steps[2]?.result,
						stored: (await runs.list('wrap-gift')).entries.length,
						wrapped: document.getElementById('wrap').checked,
						message: document.getElementById('message').value,
						trusted: document.body.dataset.trusted,
					}
				})`,
			)

			expect(refused).toEqual({
				refusal: {
					code: 'BROWSER_JOURNEY_PLACEMENT',
					message: 'Step s2 cannot execute press in this placement.',
				},
				events: '0',
				stored: 0,
			})
			expect(live).toEqual({
				outcome: 'stopped',
				steps: [
					['s1', 'done'],
					['s2', 'done'],
					['s3', 'refused'],
				],
				result:
					'Step s3 names button "Wrap all", which no element carries; call edit to remove or replace s3.',
				stored: 1,
				wrapped: true,
				message: 'Ribbon',
				trusted: 'false',
			})
		})
	})

	describe('claim 9: the journey tools over the file stores', () => {
		it('records, saves, lists, edits with a ref from the current view, and refuses a stale edit after a concurrent set, each result as the design states', async () => {
			const root = createTempDirectory('journey-store-service-')
			cleanup.add(() => root.destroy())
			const files = createFileBrowserJourneyStore({ root: root.path })
			const writer = createFileBrowserJourneyStore({ root: root.path })
			let concurrent = false
			const store: BrowserJourneyStoreInterface = {
				get: async (name, options) => {
					const read = await files.get(name, options)
					// A second store over the same root saves the journey between this read and the
					// edit's write.
					if (read !== undefined && concurrent) await writer.set(read.journey, read.revision)
					return read
				},
				set: files.set.bind(files),
				delete: files.delete.bind(files),
				list: files.list.bind(files),
			}
			const page = await context.create({ url: fixtures.url('/form') })
			pages.push(page)
			const toolset = createBrowserToolset(page, {
				journeys: { store, runs: createFileBrowserRunStore({ root: root.path }) },
			})
			toolsets.push(toolset)
			await toolset.start()
			const recording = requireToolText(
				await toolset.tools.execute({
					id: 'record',
					name: 'record',
					arguments: { journey: 'save-delivery' },
				}),
			)
			const view = requireToolText(
				await toolset.tools.execute({ id: 'look', name: 'look', arguments: { what: 'the form' } }),
			)
			requireToolText(
				await toolset.tools.execute({
					id: 'click',
					name: 'click',
					arguments: { ref: requireOutlineReference(view, 'button', 'Save draft') },
				}),
			)
			requireToolText(
				await toolset.tools.execute({
					id: 'type',
					name: 'type',
					arguments: { ref: requireOutlineReference(view, 'textbox', 'Name'), text: 'Grace' },
				}),
			)
			const saved = requireToolText(
				await toolset.tools.execute({
					id: 'save',
					name: 'save',
					arguments: { description: 'Save the delivery draft' },
				}),
			)
			const listed = requireToolText(
				await toolset.tools.execute({
					id: 'journeys',
					name: 'journeys',
					arguments: { what: 'saved journeys' },
				}),
			)
			const current = requireToolText(
				await toolset.tools.execute({ id: 'look', name: 'look', arguments: { what: 'the form' } }),
			)
			const review = requireOutlineReference(current, 'button', 'Review')
			const edited = requireToolText(
				await toolset.tools.execute({
					id: 'edit',
					name: 'edit',
					arguments: {
						journey: 'save-delivery',
						edits: [
							{
								operation: 'add',
								step: { action: 'click', arguments: {}, ref: review },
								after: 's2',
							},
						],
					},
				}),
			)
			const added: unknown = JSON.parse(requireValue(root.read('save-delivery/journey.json')))
			concurrent = true
			const stale = await toolset.tools.execute({
				id: 'stale',
				name: 'edit',
				arguments: {
					journey: 'save-delivery',
					edits: [{ operation: 'update', id: 's2', arguments: { text: 'Ada' } }],
				},
			})
			const kept = await writer.get('save-delivery')
			const listing = [
				'save-delivery "Save the delivery draft"',
				's1 click button "Save draft"',
				's2 type "Grace" into textbox "Name"',
			].join('\n')

			expect(recording).toBe(
				`Recording save-delivery; each action you take is a step; call save when it is done.\n\n${view}`,
			)
			expect(saved).toBe(`Saved save-delivery with 2 steps.\n\n${listing}`)
			expect(listed).toBe(listing)
			expect(edited).toBe(`Edited save-delivery.\n\n${listing}\ns3 click button "Review"`)
			expect(added).toMatchObject({
				revision: 2,
				journey: {
					next: 4,
					steps: [
						{ id: 's1' },
						{ id: 's2' },
						{
							id: 's3',
							action: 'click',
							target: { role: 'button', name: 'Review', reference: review },
						},
					],
				},
			})
			expect(stale).toMatchObject({
				success: false,
				error: 'Journey save-delivery changed since you read it; call journeys, then edit again.',
			})
			expect(kept?.revision).toBe(3)
			expect(kept?.journey.steps[1]?.arguments).toEqual({ text: 'Grace' })
		})
	})

	describe('claim 13: a secret stays out of every artifact', () => {
		it('records a secret through the type tool, saves, lists, and replays it with the secret as an input, and no artifact carries the value or its first four characters', async () => {
			const root = createTempDirectory('journey-secret-service-')
			cleanup.add(() => root.destroy())
			const store = createFileBrowserJourneyStore({ root: root.path })
			const page = await openBrowserJourneyPage(
				context,
				fixtures.url('/form'),
				BROWSER_JOURNEY_PASSWORD_HTML,
			)
			pages.push(page)
			const toolset = createBrowserToolset(page, {
				journeys: { store, runs: createFileBrowserRunStore({ root: root.path }) },
			})
			toolsets.push(toolset)
			const actions: BrowserAction[] = []
			toolset.emitter.on('action', (action) => actions.push(action))
			await toolset.start()
			const receipts = [
				requireToolText(
					await toolset.tools.execute({
						id: 'record',
						name: 'record',
						arguments: { journey: 'sign-in' },
					}),
				),
			]
			const view = requireToolText(
				await toolset.tools.execute({ id: 'look', name: 'look', arguments: { what: 'sign in' } }),
			)
			receipts.push(
				view,
				requireToolText(
					await toolset.tools.execute({
						id: 'type',
						name: 'type',
						arguments: {
							ref: requireOutlineReference(view, 'textbox', 'Password'),
							text: BROWSER_JOURNEY_SECRET,
							secret: true,
						},
					}),
				),
				requireToolText(
					await toolset.tools.execute({
						id: 'click',
						name: 'click',
						arguments: { ref: requireOutlineReference(view, 'button', 'Sign in') },
					}),
				),
			)
			const recorded = await page.evaluate('document.body.dataset.signed')
			const saved = requireToolText(
				await toolset.tools.execute({
					id: 'save',
					name: 'save',
					arguments: { description: 'Sign in with the password' },
				}),
			)
			const listed = requireToolText(
				await toolset.tools.execute({
					id: 'journeys',
					name: 'journeys',
					arguments: { what: 'saved journeys' },
				}),
			)
			await page.evaluate(
				`(() => { delete document.body.dataset.signed; document.querySelector('main').innerHTML = ${JSON.stringify(BROWSER_JOURNEY_PASSWORD_HTML)} })()`,
			)
			const rendered = requireToolText(
				await toolset.tools.execute({
					id: 'replay',
					name: 'replay',
					arguments: { journey: 'sign-in', inputs: { password: BROWSER_JOURNEY_SECRET } },
				}),
			)
			const replayed = await page.evaluate('document.body.dataset.signed')
			const ids = root.names('sign-in/runs')
			const directory = `sign-in/runs/${requireValue(ids[0])}`
			const runFile = requireValue(root.read(`${directory}/run.json`))
			const journeyFile = requireValue(root.read('sign-in/journey.json'))
			const run: unknown = JSON.parse(runFile)
			const journey = requireValue(await store.get('sign-in')).journey
			const modules = [
				compileBrowserJourney(journey).source,
				compileBrowserJourney(journey, { language: 'typescript' }).source,
			]
			const listing = [
				'sign-in "Sign in with the password" (parameters: password (secret))',
				's1 type (secret) as password into textbox "Password"',
				's2 click button "Sign in"',
			].join('\n')
			const artifacts = {
				journeyFile,
				runFile,
				saved,
				listed,
				rendered,
				receipts: receipts.join('\n'),
				actions: JSON.stringify(actions),
				modules: modules.join('\n'),
			}

			expect(recorded).toBe(String(BROWSER_JOURNEY_SECRET.length))
			expect(replayed).toBe(String(BROWSER_JOURNEY_SECRET.length))
			expect(saved).toBe(`Saved sign-in with 2 steps.\n\n${listing}`)
			expect(listed).toBe(listing)
			expect(maskBrowserReferences(rendered).split('\n').slice(0, 3)).toEqual([
				'Replayed sign-in: 2 of 2 steps.',
				's1 Typed a secret into e# textbox "Password".',
				's2 Clicked e# button "Sign in".',
			])
			expect(journey.parameters).toEqual({ password: { secret: true } })
			expect(ids).toHaveLength(1)
			expect(root.names(directory)).toEqual(['run.json'])
			expect(run).toMatchObject({ outcome: 'complete', inputs: {} })
			expect(isRecord(run) && 'output' in run).toBe(false)
			expect(runFile.includes('"capture"')).toBe(false)
			expect(actions.filter((action) => action.secret === true)).toHaveLength(2)
			for (const fragment of [BROWSER_JOURNEY_SECRET, BROWSER_JOURNEY_SECRET.slice(0, 4)])
				expect(
					Object.entries(artifacts)
						.filter(([, text]) => text.includes(fragment))
						.map(([name]) => name),
				).toEqual([])
		})
	})
})

describe('claim 5: a one-step replay agrees with a direct call for every native action', () => {
	const cleanup = createTeardown()
	const pages: BrowserPageInterface[] = []
	const toolsets: BrowserToolsetInterface[] = []
	let fixtures: FixtureServerInterface
	let browser: BrowserInterface

	beforeAll(async () => {
		fixtures = await createFixtureServer()
		cleanup.add(() => fixtures.destroy())
		const profile = createTempDirectory('journey-equality-service-')
		cleanup.add(() => profile.destroy())
		browser = createBrowser({
			executable: requireSystemBrowser().executable,
			headless: true,
			profile: profile.path,
			args: SERVICE_BROWSER_ARGS,
			cdp: { port: await reservePort() },
			timeout: 20_000,
		})
		cleanup.add(() => browser.destroy())
		await browser.connect()
	})
	afterEach(async () => {
		for (const toolset of toolsets.splice(0)) await toolset.destroy()
		for (const page of pages.splice(0)) if (!page.closed) await page.close()
	})
	afterAll(async () => {
		await cleanup.destroy()
	})

	it.each(BROWSER_JOURNEY_SERVICE_CASES)(
		'replays $name to the outcome, stage, reason, and receipt of a direct tools.execute on a second fresh page',
		async (scenario) => {
			const journey = createBrowserJourneyServiceJourney(scenario, (path) => fixtures.url(path))
			const step = requireValue(journey.steps[0])
			const replayed = await browser.create({ url: fixtures.url(scenario.route) })
			pages.push(replayed)
			const replaying = createBrowserToolset(replayed)
			toolsets.push(replaying)
			await replaying.start()
			const run = await createBrowserReplay(replaying, { journey }).execute()
			const page = await browser.create({ url: fixtures.url(scenario.route) })
			pages.push(page)
			const toolset = createBrowserToolset(page)
			toolsets.push(toolset)
			const actions: BrowserAction[] = []
			toolset.emitter.on('action', (action) => actions.push(action))
			await toolset.start()
			const target =
				'target' in scenario
					? await locateBrowserTarget(page, scenario.target, { id: step.id })
					: undefined
			const text = requireToolText(
				await toolset.tools.execute({
					id: step.id,
					name: step.action,
					arguments:
						target === undefined ? step.arguments : { ...step.arguments, ref: target.reference },
				}),
			)
			const direct = requireValue(actions[0])

			expect(actions).toHaveLength(1)
			expect(run.outcome).toBe('complete')
			expect(run.steps).toHaveLength(1)
			expect({
				outcome: run.steps[0]?.outcome,
				stage: run.steps[0]?.stage,
				reason: run.steps[0]?.reason,
				result: maskBrowserReferences(run.steps[0]?.result ?? ''),
			}).toStrictEqual({
				outcome: 'done',
				stage: direct.stage,
				reason: direct.reason,
				result: maskBrowserReferences(direct.receipt),
			})
			expect(maskBrowserReferences(text)).toContain(maskBrowserReferences(direct.receipt))
		},
	)
})
