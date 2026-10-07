// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest. The constants that follow preserve this
// package's own parity policy.

import type { BrowserLine, BrowserOutlineNode } from '@src/core'
import { GuideCommand } from '@orkestrel/guide/server'
import { readInventory } from '@orkestrel/test/server'
import { createVitest } from 'vitest/node'

/** Every fence language this package's guides are allowed to use. */
const FENCE_LANGUAGES = Object.freeze(['ts'])
/** The fence language whose blocks count as worked examples. */
const EXAMPLE_LANGUAGE = 'ts'
/** The package identity that binds its manifest, module map, and README pitch. */
const PACKAGE_NAME = '@orkestrel/browser'
/** The one guide this package sources, whose tagline the README pitch equals. */
const GUIDE_SPEC = 'guides/browser.md'
/** Each import specifier this package's own guides may resolve against. */
const MODULES = Object.freeze({
	[PACKAGE_NAME]: 'src/core',
	[`${PACKAGE_NAME}/server`]: 'src/server',
	[`${PACKAGE_NAME}/browser`]: 'src/browser',
	'@src/core': 'src/core',
	'@src/server': 'src/server',
	'@src/browser': 'src/browser',
})
/**
 * Declarations deliberately kept out of the barrel, as `computeSymbolKey` strings.
 *
 * A class that one-class-per-file evicted from its single consumer cannot become a
 * local, so it stays exported without being public. Naming it here is what makes that
 * intentional rather than forgotten — and the assertion that follows it fails when a name
 * here stops being stranded, so the list cannot rot.
 */
const INTERNAL: readonly string[] = Object.freeze([
	'class BrowserPage',
	'class BrowserFrame',
	'class BrowserJourneyToolset',
	'class BrowserPageElement',
	'class BrowserElementManager',
	'class BrowserDOMElement',
	'class BrowserDOMElementManager',
	'class BrowserDialog',
	'class BrowserDownload',
	'class BrowserFileChooser',
	'class BrowserHandle',
	'class BrowserHold',
	'class FileBrowserStore',
	'class BrowserNavigationRecord',
	'class BrowserRegistry',
	'class BrowserRoute',
	'class BrowserWorker',
])
/** The heading every fence driving the toolset with a small model sits under. */
const SMALL_MODEL_TITLE = 'Drive a page with a small model'
/**
 * The system prompt recommended for the reading vocabulary, transcribed for fence parity.
 */
const SMALL_MODEL_PROMPT =
	'You control a web browser with tools and must call a tool before you answer. ' +
	'The first message shows numbered page lines; references such as e4 name its elements. ' +
	'To learn a fact, call read with from 1 and search words from your question; follow a footer by calling read with its from line. ' +
	"To use the site's search box, call type with its reference, the words, and submit true. " +
	'To press a button or follow a link, call click with its reference from the latest result. Never invent a reference. ' +
	'If text you expect has not appeared, call wait once. ' +
	'When the task is done, answer in one short sentence.'
/** The toolset and seeding lines of the Surface fence of that title, transcribed byte for byte. */
const SMALL_MODEL_LINES: readonly string[] = Object.freeze([
	'const toolset = createBrowserToolset(page, { tools: createToolManager() })',
	'await toolset.start()',
	"toolset.tools.tools().map((tool) => tool.name) // ['read', 'click', 'type', 'press', 'navigate', 'wait']",
	"const seeded = await toolset.tools.execute({\n\tid: 'seed',\n\tname: 'read',\n\targuments: { from: 1 },\n})",
	'const view = seeded.success ? String(seeded.value) : seeded.error',
	'\tcontent: `What does the Alpine Kettle cost?\\n\\nThe browser shows this page:\\n${view}`,',
])
/** The receipt the guide's Tools section quotes for a `read` call that carries `ref`. */
const UNADVERTISED_RECEIPT =
	'The read tool takes no ref parameter; call read with from, to, and search.'
/** The failure a page command reports when its renderer hangs past the command deadline. */
const HUNG_FAILURE = 'Runtime.evaluate timed out'
/** The headings that open and close the guide's Tools table. */
const TOOLS_SECTION = Object.freeze(['\n### Tools\n', '\n### Receipts\n'])
/** The heading of the fence that shows the `add-kettle` listing. */
const LISTING_TITLE = 'The listing'
/** The heading of the fence that shows the render of a complete `add-kettle` run. */
const RUN_TITLE = 'Replay a journey'
/** The heading of the fence that carries the `add-kettle` module the compiler emits. */
const MODULE_TITLE = 'Generate a module from a journey'
/** Matches one string literal of a generated module, quotes and escapes included. */
const MODULE_STRING = /('(?:[^'\\\n]|\\.)*')/u
/** Matches a `` `name` (detail) `` parameter entry of a Tools table cell. */
const TOOL_PARAMETER = /`(\w+)` \(([^)]*)\)/gu
/** Matches an in-page assignment or property definition that replaces a page dialog function. */
const DIALOG_OVERRIDE =
	/\b(?:alert|confirm|prompt)\s*=(?!=)|defineProperty\([^)]*['"](?:alert|confirm|prompt)['"]/

await new GuideCommand({
	root: new URL('../', import.meta.url),
	patterns: [
		'src/**/*.ts',
		'tests/**/*.ts',
		'tests/mirrors/*',
		'guides/*.md',
		'*.md',
		'package.json',
	],
	modules: MODULES,
	languages: FENCE_LANGUAGES,
	language: EXAMPLE_LANGUAGE,
	reader: readInventory,
	runner: createVitest,
}).execute(async ({ files, report, rows }) => {
	const { isRecord, parseJSON } = await import('@orkestrel/contract')
	const {
		computeSymbolKey,
		createSourceManager,
		extractFenceImports,
		findMissing,
		findMissingSymbols,
		isExternalLink,
		resolveLink,
	} = await import('@orkestrel/guide')
	const { requireValue } = await import('@orkestrel/test')
	const { describe, expect, it } = await import('vitest')
	const own = requireValue(
		rows.find((row) => row.entry.spec === GUIDE_SPEC),
		`Missing manifest row: ${GUIDE_SPEC}`,
	)
	const manifest = parseJSON(requireValue(files['package.json'], 'Missing inventory: package.json'))
	if (!isRecord(manifest)) throw new Error('Invalid package manifest: package.json')
	const sources = createSourceManager({ files, modules: MODULES })

	it('audit repair 8: published examples use addressed read calls and no removed footer constant', async () => {
		const readme = requireValue(files['README.md'])
		expect(readme).not.toMatch(/name: '(look|plain)'/)
		expect(readme).toContain("name: 'read', arguments: { from: 1, search: 'Email' }")
		expect(readme).not.toContain('a recorded exchange')
		expect(requireValue(files['src/core/helpers.ts'])).not.toContain('BROWSER_TOOL_VIEW_FOOTER')
		const { createBrowserElementFixture } = await import('./setup.js')
		const { createBrowserToolset } = await import('@src/core')
		const fixture = await createBrowserElementFixture()
		const toolset = createBrowserToolset(fixture.page)
		try {
			await toolset.start()
			for (const search of ['Email', 'delivery', 'confirmation'])
				expect(
					await toolset.tools.execute({ id: search, name: 'read', arguments: { from: 1, search } }),
				).toMatchObject({ success: true })
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})
	it('audit repair 9: guide states the tested placement limits and labels the MCP illustration', async () => {
		const guide = requireValue(files[GUIDE_SPEC])
		expect(guide).toContain('when no submit event fires or a field is invalid')
		expect(guide).toContain('unless an adopted page tool takes the name')
		expect(guide).toContain('whitespace-normalized, concatenated text')
		expect(guide).toContain('otherwise it opens at line 1')
		expect(guide).toContain('unexecuted illustration')
		expect(guide).not.toContain('the earlier recorded exchange')
		expect(guide).not.toContain('never from the model’s answer')
		expect(guide).not.toContain('removes the observer and returns')
		const { findBrowserText, renderBrowserFooter } = await import('@src/core')
		expect(
			findBrowserText(
				[
					{ spans: [{ category: 'text', text: 'Earlier' }] },
					{ spans: [{ category: 'text', text: 'Order' }] },
					{ spans: [{ category: 'text', text: 'placed' }] },
				],
				'Order placed',
			),
		).toBe(2)
		expect(findBrowserText([], 'Missing')).toBe(1)
		expect(renderBrowserFooter(1, 4, 4, 'journeys')).toBe('[lines 1–4 of 4; the whole listing]')
	})
	it('audit repair 12: boundBrowserText example states the actual whole-result bound', async () => {
		const { boundBrowserText } = await import('@src/core')
		const actual = boundBrowserText('abcdef', 4, 'the rest was cut')
		expect(actual).toBe('abc…')
		expect(requireValue(files['src/core/helpers.ts'])).toContain(
			"boundBrowserText('abcdef', 4, 'the rest was cut') // '" + actual + "'",
		)
		expect(requireValue(files['src/core/helpers.ts'])).toContain(
			'cut text plus footer fits `limit`',
		)
	})

	it('manifest lists at least one guide', () => {
		expect(report.input).toEqual([])
		expect(rows.length).toBeGreaterThan(0)
		expect(own.entry.spec).toBe(GUIDE_SPEC)
	})

	it('executes the whole-page reading and matching fence', async () => {
		const { createBrowserReading, collectBrowserWords, scanBrowserText, renderBrowserMatches } =
			await import('@src/core')
		const reading = createBrowserReading({
			url: 'https://example.test/',
			title: '',
			html: '<nav>Menu</nav><main><p>Blue kettle</p></main>',
		})
		expect(reading.text().text).toBe('Menu\nBlue kettle')
		expect(reading.text({ distill: true }).text).toBe('Blue kettle')
		expect([...collectBrowserWords('Blue BLUE to 12')]).toEqual(['blue'])
		const matches = scanBrowserText(reading.text().text, 'blue kettle')
		expect(matches).toEqual([{ offset: 5, text: 'Blue kettle' }])
		expect(
			renderBrowserMatches(
				'Matches:',
				matches.map((match) => `[${match.offset}] ${match.text}`),
				100,
			),
		).toBe('Matches:\n[5] Blue kettle\n\n')
	})
	it('executes the numbered-line rendering fence', async () => {
		const {
			abbreviateBrowserText,
			belongsBrowserOutline,
			redactBrowserText,
			renderBrowserFooter,
			renderBrowserLine,
			renderBrowserPassage,
			renderBrowserSpans,
			renderBrowserWindow,
			scanBrowserLines,
			validateBrowserLines,
			wrapBrowserLine,
		} = await import('@src/core')
		const root: BrowserOutlineNode = {
			id: 'root',
			session: 'main',
			reference: undefined,
			properties: {},
			parent: undefined,
			children: ['delivery'],
			backend: undefined,
			frame: undefined,
			ignored: false,
			role: undefined,
			name: undefined,
			description: undefined,
			value: undefined,
		}
		const link: BrowserOutlineNode = {
			...root,
			children: [],
			id: 'delivery',
			parent: 'root',
			session: 'main',
			reference: 'e12345',
			role: 'link',
			name: 'Shipping',
			properties: { url: 'https://shop.example.test/delivery' },
		}
		expect(belongsBrowserOutline(link, root, new Map([['main:root', root]]))).toBe(true)
		expect(belongsBrowserOutline(root, link, new Map([['main:root', root]]))).toBe(false)
		const lines: readonly BrowserLine[] = [
			{ spans: renderBrowserSpans(link, 'https://shop.example.test/') },
			{ spans: [{ category: 'text', text: 'We ship every weekday.' }] },
			{ spans: [{ category: 'text', text: 'Contact the workshop.' }] },
		]
		expect(renderBrowserLine(lines[0] ?? { spans: [] })).toBe('e12345 link "Shipping" /delivery')
		expect(scanBrowserLines(lines, 'ship')).toEqual([1, 2])
		expect(scanBrowserLines(lines, 'e12345')).toEqual([])
		expect(scanBrowserLines(lines, 'delivery', 2)).toEqual([])
		expect(validateBrowserLines(1, 2, lines.length)).toBeUndefined()
		expect(renderBrowserWindow(lines, 1, 2, 'Delivery', 4_000)).toBe(
			'Delivery\n1: e12345 link "Shipping" /delivery\n2: We ship every weekday.\n[lines 1–2 of 3; 1 below; call read with from 3 for more]',
		)
		expect(renderBrowserFooter(3, 3, 3)).toBe('[lines 3–3 of 3; 2 above; end of page]')
		expect(
			renderBrowserPassage(
				{
					url: 'https://shop.example.test/',
					title: 'Delivery',
					lines,
					from: 2,
					to: 2,
					search: 'shipping',
					tabs: [],
					changed: true,
				},
				4_000,
			),
		).toBe(
			'page "Delivery" https://shop.example.test/ (3 lines)\nThe page changed since the last view; line numbers might differ.\n1 line matches "shipping": 2\n2: We ship every weekday.\n[lines 2–2 of 3; 1 above, 1 below; call read with from 3 for more]',
		)
		expect(
			wrapBrowserLine({ spans: [{ category: 'text', text: 'x'.repeat(801) }] }).map(
				renderBrowserLine,
			),
		).toEqual(['x'.repeat(800), '↳x'])
		expect(abbreviateBrowserText('Alpine Kettle', 7)).toBe('Alpine…')
		expect(redactBrowserText('Order for Ada', ['Ada'])).toBe('Order for [redacted]')
	})
	it('proves range refusals, search boundaries, footer forms, and whole-window budgets', async () => {
		const {
			renderBrowserPassage,
			renderBrowserWindow,
			renderBrowserFooter,
			scanBrowserLines,
			validateBrowserLines,
			parseBrowserReference,
			BROWSER_TOOL_LIMIT,
			boundBrowserText,
			BROWSER_TOOL_CUT_FOOTER,
		} = await import('@src/core')
		const lines: readonly BrowserLine[] = Array.from({ length: 120 }, (_, index) => ({
			spans: [
				{ category: 'text', text: index === 110 ? 'Shipping schedules' : 'Workshop details' },
			],
		}))
		const first = renderBrowserWindow(lines, 1, undefined, 'Delivery', BROWSER_TOOL_LIMIT)
		expect(first).toContain('[lines 1–100 of 120; 20 below; call read with from 101 for more]')
		expect(renderBrowserWindow(lines, 101, 999, 'Delivery', BROWSER_TOOL_LIMIT)).toContain(
			'[lines 101–120 of 120; 100 above; end of page]',
		)
		const searched = renderBrowserPassage(
			{
				url: 'https://shop.example.test/',
				title: 'Delivery',
				lines,
				from: 1,
				search: 'ship schedule',
				tabs: [],
				changed: false,
			},
			BROWSER_TOOL_LIMIT,
		)
		expect(searched).toContain(
			'1 line matches "ship schedule": 111\n110: Workshop details\n111: Shipping schedules',
		)
		expect(scanBrowserLines(lines, 'shipping', 1, 110)).toEqual([])
		expect(scanBrowserLines(lines, 'hipping')).toEqual([])
		expect(scanBrowserLines(lines, 'SHIPPING')).toEqual([111])
		expect(scanBrowserLines(lines, 'sh')).toEqual([])
		expect(scanBrowserLines(lines, 'shipping schedules workshop')).toEqual([111])
		const missing = renderBrowserPassage(
			{
				url: 'about:blank',
				title: '',
				lines,
				from: 2,
				to: 2,
				search: 'missing',
				tabs: [],
				changed: false,
			},
			BROWSER_TOOL_LIMIT,
		)
		expect(missing).toContain('No line from 2 on matches "missing".\n2: Workshop details')
		expect(
			renderBrowserPassage(
				{ url: 'about:blank', title: '', lines: [], from: 1, tabs: [], changed: false },
				BROWSER_TOOL_LIMIT,
			),
		).toBe('page "" about:blank (0 lines)\n[empty page; the whole page]')
		expect(renderBrowserFooter(1, 7, 7)).toBe('[lines 1–7 of 7; the whole page]')
		expect(renderBrowserFooter(48, 52, 52)).toBe('[lines 48–52 of 52; 47 above; end of page]')
		for (const from of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 121])
			expect(() => validateBrowserLines(from, undefined, 120)).toThrow(
				expect.objectContaining({ code: 'TOOLSET_ARGUMENT' }),
			)
		expect(() => validateBrowserLines(2, 1)).toThrow(
			expect.objectContaining({ code: 'TOOLSET_ARGUMENT' }),
		)
		expect(parseBrowserReference('12')).toBeUndefined()
		expect(parseBrowserReference('e12')).toBe('e12')
		expect(boundBrowserText('x'.repeat(5_000), 4_000, BROWSER_TOOL_CUT_FOOTER).length).toBe(4_000)
		expect(() => renderBrowserWindow(lines, 1, undefined, 'Delivery', 20)).toThrow(
			expect.objectContaining({ code: 'TOOLSET_LIMIT' }),
		)
		const bounded = renderBrowserPassage(
			{
				url: 'https://shop.example.test/' + 'u'.repeat(5000),
				title: 't'.repeat(5000),
				lines,
				from: 1,
				search: 'workshop',
				changed: false,
				tabs: Array.from({ length: 100 }, (_, index) => ({
					id: `t${index + 1}`,
					title: 'Tab '.repeat(30),
					url: 'about:blank',
					current: index === 0,
				})),
			},
			BROWSER_TOOL_LIMIT,
		)
		expect(bounded).toContain('(current)')
		expect(bounded).toContain('more tabs omitted')
		expect(bounded).toContain('and 69 more; add words to narrow')
		expect(bounded.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
		expect(bounded).toMatch(/\[lines 1–\d+ of 120; \d+ below; call read with from \d+ for more\]$/)
	})
	it('executes the numbered listing and cart-visit edit fence', async () => {
		const { BrowserToolset, createMemoryBrowserJourneyStore } = await import('@src/core')
		const { BrowserJourneyToolset } = await import('../src/core/BrowserJourneyToolset.js')
		const { createBrowserJourneyFixture, createBrowserViewDouble } = await import('./setup.js')
		const fence = requireValue(
			own.guide.fences().find((entry) => entry.title === 'Edit a saved journey'),
		)
		const shown = [
			...(fence.code.split('await toolset.tools.execute')[1] ?? '').matchAll(/^\/\/ ?(.*)$/gm),
		]
			.map((line) => line[1])
			.join('\n')
		const store = createMemoryBrowserJourneyStore()
		await store.set(
			createBrowserJourneyFixture(
				[
					{ action: 'click', arguments: {}, target: { role: 'link', name: 'Cart' } },
					{
						action: 'type',
						arguments: { text: 'Ada Lovelace', submit: true },
						target: { role: 'textbox', name: 'Full name' },
					},
					{ action: 'click', arguments: {}, target: { role: 'link', name: 'Orders' } },
				],
				{ name: 'place-order', description: 'Order the Alpine Kettle with a name' },
			),
		)
		const toolset = new BrowserToolset(createBrowserViewDouble())
		const journeys = new BrowserJourneyToolset(toolset, { store })
		try {
			const tool = requireValue(toolset.tools.tool('journeys'))
			expect(
				await tool.execute(
					{ from: 1, search: 'place-order' },
					{ signal: new AbortController().signal },
				),
			).toBe(shown)
			const edited = await requireValue(toolset.tools.tool('edit')).execute(
				{
					journey: 'place-order',
					edits: [
						{ operation: 'declare', name: 'customer', parameter: { default: 'Ada Lovelace' } },
						{ operation: 'update', id: 's2', arguments: { text: { parameter: 'customer' } } },
						{ operation: 'remove', id: 's1' },
					],
				},
				{ signal: new AbortController().signal },
			)
			const editedComments = [
				...(fence.code.split('await toolset.tools.execute')[2] ?? '').matchAll(/^\/\/ ?(.*)$/gm),
			]
				.map((line) => line[1])
				.join('\n')
			expect(edited).toBe(editedComments)
			const revision = requireValue(await store.get('place-order'))
			expect(revision.journey.steps.map((step) => step.id)).toEqual(['s2', 's3'])
			expect(
				revision.journey.steps.filter((step) => step.arguments['submit'] === true),
			).toHaveLength(1)
		} finally {
			await journeys.destroy()
			await toolset.destroy()
		}
	})
	it('recaptures a continuation and keeps unchanged references stable', async () => {
		const { createBrowserToolset, BROWSER_TOOL_LIMIT } = await import('@src/core')
		const { createBrowserElementFixture, BROWSER_ELEMENT_AX_FIXTURE } = await import('./setup.js')
		let changed = false
		const fixture = await createBrowserElementFixture({
			local: true,
			accessibility: (message) =>
				fixture.transport.reply(message.id, {
					nodes: BROWSER_ELEMENT_AX_FIXTURE.nodes.map((node) =>
						node.nodeId === 'email' && changed ? { ...node, name: { value: 'Buyer email' } } : node,
					),
				}),
		})
		const toolset = createBrowserToolset(fixture.page)
		try {
			await toolset.start()
			const first = await toolset.read({ from: 1, to: 1 })
			const from = Number(requireValue(/call read with from (\d+) for more/.exec(first))[1])
			expect(from).toBe(2)
			const next = await toolset.read({ from })
			expect(next).toContain('\n2: ')
			expect(await toolset.read({ from })).toBe(next)
			changed = true
			const fresh = await toolset.read({ from })
			expect(fresh).toContain('The page changed since the last view; line numbers might differ.')
			expect(fresh).toContain('\n2: ')
			expect(fresh).toContain('textbox "Buyer email"')
			expect(fresh.match(/\be\d+\b/g)).toEqual(next.match(/\be\d+\b/g))
			const bounded = await toolset.read({ from: 1, limit: 180 })
			expect(bounded.length).toBeLessThanOrEqual(180)
			expect(fresh.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
			const seeded = await toolset.tools.execute({
				id: 'read',
				name: 'read',
				arguments: { from: 1 },
			})
			expect(seeded.success).toBe(true)
			expect(seeded.success ? seeded.value : seeded.error).toContain('\n1: ')
			const missing = await toolset.tools.execute({ id: 'missing', name: 'read', arguments: {} })
			expect(missing).toMatchObject({ success: false })
		} finally {
			await toolset.destroy()
			await fixture.client.close()
		}
	})
	it('lists the revised MCP vocabulary and refuses removed tool names', async () => {
		const { createBrowseFixture } = await import('./setupServer.js')
		const fixture = createBrowseFixture()
		try {
			await fixture.server.start()
			const listed = (await fixture.pair.request(2, 'tools/list'))['tools']
			if (!Array.isArray(listed)) throw new Error('Missing tools/list array')
			const names = listed.map((tool: unknown) => (isRecord(tool) ? tool['name'] : undefined))
			expect(names).toEqual([
				'read',
				'click',
				'type',
				'press',
				'navigate',
				'wait',
				'dialog',
				'switch',
				'record',
				'save',
				'journeys',
				'edit',
				'replay',
				'forget',
				'capture',
				'acquire',
				'execute',
				'tools',
				'destroy',
			])
			const fence = requireValue(
				own.guide
					.fences()
					.find((entry) => entry.title === 'Register the browse binary with Claude Code'),
			)
			expect(fence.code).toContain('// <- ' + names.join(', '))
			for (const [index, name] of ['look', 'plain', 'tabs'].entries()) {
				const refused = await fixture.pair.call(3 + index, name, {})
				expect(refused.error).toBe(true)
				expect(refused.text).toContain(name)
			}
			const reading = await fixture.pair.call(6, 'read', { from: 1 })
			expect(reading.error).toBe(false)
			expect(reading.text).toMatch(/^page .+\(\d+ lines\)/)
			expect(reading.text.length).toBeLessThanOrEqual(4_000)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	// The example half of the equality case is silent over an empty population: with no
	// title on both sides `findDrift` compares no pair and the case passes on the summaries
	// alone. This pins the population this repository's own guide contributes, so removing
	// every `@example` title reddens the suite instead of quietly retiring half the gate.
	// The failure names both title sets, because a pin reporting only its own emptiness
	// leaves the reader to work out which side dropped the title.
	it('pairs at least one example title across the guide and the source', () => {
		expect(report.examples.titles.filter((finding) => finding.spec === GUIDE_SPEC)).toEqual([])
	})

	// The README's pitch and the guide's tagline are one text, each read as the blockquote
	// under its file's H1. The native report owns their comparison. The manifest assertion
	// binds that report to this package rather than allowing an unrelated package identity.
	it('opens the README with the guide tagline', () => {
		expect(manifest.name).toBe(PACKAGE_NAME)
		expect(report.pitch).toEqual([])
	})

	// `guides/browser.md` carries the system prompt a small model passed with and claims the tools
	// a page-backed toolset lists. Name parity proves neither, so the prompt is read out of each fence
	// of that title and compared with the transcribed constant, and the fence's toolset and seeding
	// lines run against a real `BrowserPage` over the scripted CDP fixture. The agent half needs a live
	// model and a package this workspace does not install, and it claims no value.
	describe(SMALL_MODEL_TITLE, () => {
		const fences = own.guide
			.fences()
			.filter((fence) => fence.title === SMALL_MODEL_TITLE && fence.language === EXAMPLE_LANGUAGE)

		it('carries the store proof system prompt in the Surface fence and the pattern fence', () => {
			expect(fences).toHaveLength(2)
			for (const fence of fences) {
				const declared =
					/const system =\n((?:\t(?:'[^'\n]*'|"[^"\n]*")(?: \+)?\n)+)/.exec(fence.code)?.[1] ?? ''
				const literals = [...declared.matchAll(/'([^'\n]*)'|"([^"\n]*)"/g)].map(
					(match) => match[1] ?? match[2] ?? '',
				)
				expect(literals.join('')).toBe(SMALL_MODEL_PROMPT)
			}
		})

		it('carries the transcribed toolset lines in the Surface fence', () => {
			for (const line of SMALL_MODEL_LINES) expect(fences[0]?.code).toContain(line)
		})

		it('lists the tools its comment claims and seeds numbered lines over a real page', async () => {
			const { createBrowserElementFixture } = await import('./setup.js')
			const { createBrowserToolset } = await import('@src/core')
			const { createToolManager } = await import('@orkestrel/tool')
			const { client, page } = await createBrowserElementFixture()
			try {
				const toolset = createBrowserToolset(page, { tools: createToolManager() })
				await toolset.start()
				expect(toolset.tools.tools().map((tool) => tool.name)).toEqual([
					'read',
					'click',
					'type',
					'press',
					'navigate',
					'wait',
				])
				const seeded = await toolset.tools.execute({
					id: 'seed',
					name: 'read',
					arguments: { from: 1 },
				})
				expect(seeded.success ? String(seeded.value) : seeded.error).toMatch(
					/^page "[^"\n]*" https:\/\/example\.test\/cart \(\d+ lines\)\n1: /,
				)
				await toolset.destroy()
			} finally {
				await client.close()
			}
		})
	})

	// The guide's Tools section states that a call carrying a parameter its tool does not advertise
	// is refused before the handler runs, and quotes the receipt. The quote is checked against what a
	// real toolset returns over the scripted CDP fixture, and the transport's record shows that the
	// refused call sent nothing.
	it('refuses a parameter the tool does not advertise with the receipt the guide quotes', async () => {
		expect(files[GUIDE_SPEC]).toContain(`\`${UNADVERTISED_RECEIPT}\``)
		const { createBrowserElementFixture } = await import('./setup.js')
		const { createBrowserToolset } = await import('@src/core')
		const { createToolManager } = await import('@orkestrel/tool')
		const { client, page, transport } = await createBrowserElementFixture()
		try {
			const toolset = createBrowserToolset(page, { tools: createToolManager() })
			await toolset.start()
			const sent = transport.sent.length
			const result = await toolset.tools.execute({
				id: 'unadvertised',
				name: 'read',
				arguments: { from: 1, search: 'the cart', ref: 'e1' },
			})
			expect(result).toMatchObject({ success: false, error: UNADVERTISED_RECEIPT })
			expect(transport.sent.length).toBe(sent)
			await toolset.destroy()
		} finally {
			await client.close()
		}
	})

	// The guide's holder limits state that a renderer that hangs without crashing raises no loss:
	// while the browser answers its ping, a call that fails on the page answers its plain failure,
	// launches nothing, and leaves the holder in the same context. The fixture fails the page's
	// awaited evaluation the way a hung renderer's command deadline does and keeps the ping
	// answering.
	it('answers a hung page plainly and keeps the context while the browser answers its ping', async () => {
		const { createBrowseFixture } = await import('./setupServer.js')
		const fixture = createBrowseFixture(undefined, {
			evaluation: (message, transport) => {
				if (message.params?.['awaitPromise'] === true) transport.fail(message.id, HUNG_FAILURE)
				else transport.reply(message.id, { result: { value: true } })
			},
		})
		try {
			await fixture.server.start()
			const browser = requireValue(fixture.launcher.browsers[0])
			const page = requireValue(browser.context()?.page())
			const answer = await fixture.pair.call(2, 'wait', { text: 'Order confirmed' })
			expect(answer.error).toBe(true)
			expect(answer.text).not.toContain('SERVER_')
			expect((await fixture.pair.call(3, 'read', { from: 1, search: 'cart' })).text).not.toContain(
				'SERVER_CRASH',
			)
			expect(fixture.launcher.browsers).toHaveLength(1)
			expect(browser.destroyed).toBe(false)
			expect(browser.contexts()).toHaveLength(1)
			expect(browser.context()?.page()).toBe(page)
			expect(page.closed).toBe(false)
		} finally {
			await fixture.teardown.destroy()
		}
	})

	// The guide's Tools table and journey fences quote what the source advertises and returns. A
	// name check proves neither, so each row is compared with `BROWSER_TOOL_COPY`, and each fence
	// with what the renderers and the compiler return for the design's `add-kettle` journey.
	describe('Journeys', () => {
		const fences = own.guide.fences().filter((fence) => fence.language === EXAMPLE_LANGUAGE)

		it('lists every tool BROWSER_TOOL_COPY advertises, with its parameters, annotations, and description', async () => {
			const { BROWSER_TOOL_COPY } = await import('@src/core')
			const text = files[GUIDE_SPEC] ?? ''
			const [open = '', close = ''] = TOOLS_SECTION
			const section = text.slice(text.indexOf(open), text.indexOf(close))
			const table = section
				.split('\n')
				.filter((line) => line.startsWith('| `'))
				.map((line) =>
					line
						.replace(/^\|\s*|\s*\|$/gu, '')
						.split(' | ')
						.map((cell) => cell.trim()),
				)
			expect(table.map(([tool]) => tool)).toEqual(
				Object.keys(BROWSER_TOOL_COPY).map((name) => `\`${name}\``),
			)
			for (const [index, copy] of Object.values(BROWSER_TOOL_COPY).entries()) {
				const [, parameters = '', annotations = '', , description = ''] = table[index] ?? []
				const schema = isRecord(copy.parameters) ? copy.parameters : {}
				const properties = isRecord(schema['properties']) ? Object.keys(schema['properties']) : []
				const required = Array.isArray(schema['required']) ? schema['required'] : []
				const listed = [...parameters.matchAll(TOOL_PARAMETER)]
				expect(listed.map((match) => match[1])).toEqual(properties)
				expect(
					listed.filter((match) => /\brequired\b/u.test(match[2] ?? '')).map((match) => match[1]),
				).toEqual(properties.filter((name) => required.includes(name)))
				const marked = Object.entries(copy.annotations ?? {})
					.filter(([, value]) => value === true)
					.map(([name]) => `\`${name}\``)
				expect(annotations).toBe(marked.length === 0 ? 'none' : marked.join(', '))
				expect(description).toBe(`\`${copy.description}\``)
			}
		})

		it('shows the listing renderBrowserJourney returns for add-kettle', async () => {
			const { renderBrowserJourney } = await import('@src/core')
			const { BROWSER_JOURNEY_FIXTURE } = await import('./setup.js')
			const shown = fences.filter((fence) => fence.title === LISTING_TITLE)
			expect(shown).toHaveLength(1)
			const comment = (shown[0]?.code ?? '')
				.split('\n')
				.filter((line) => line.startsWith('//'))
				.map((line) => line.replace(/^\/\/ ?/u, ''))
				.join('\n')
			expect(comment).toBe(renderBrowserJourney(BROWSER_JOURNEY_FIXTURE))
		})

		it('shows the render renderBrowserRun returns for a complete add-kettle run', async () => {
			const { renderBrowserRun } = await import('@src/core')
			const { BROWSER_RUN_FIXTURE } = await import('./setup.js')
			const view =
				'page "Cart" https://shop.example.test/cart (5 lines)\n1: e40 link "Catalogue" /\n2: e41 link "Cart" /cart\n3: e42 link "Checkout" /checkout\n4: # Your cart\n5: Alpine Kettle\n[lines 1–5 of 5; the whole page]'
			const shown = fences.filter((fence) => fence.title === RUN_TITLE)
			expect(shown).toHaveLength(1)
			const comment = (shown[0]?.code ?? '')
				.split('\n')
				.filter((line) => line.startsWith('//'))
				.map((line) => line.replace(/^\/\/ ?/u, ''))
				.join('\n')
			expect(comment).toBe(renderBrowserRun(BROWSER_RUN_FIXTURE, view))
		})

		// The formatter lays the guide's fence out at its print width, so the fence and the compiled
		// source are compared outside their string literals with whitespace and trailing commas
		// dropped. The control proves the comparison still sees a removed step.
		it('carries the module compileBrowserJourney emits for add-kettle, laid out by the formatter', async () => {
			const { compileBrowserJourney, editBrowserJourney } = await import('@src/core')
			const { BROWSER_JOURNEY_FIXTURE } = await import('./setup.js')
			const shown = fences.filter((fence) => fence.title === MODULE_TITLE)
			expect(shown).toHaveLength(1)
			const [guide, compiled, shortened] = [
				shown[0]?.code ?? '',
				compileBrowserJourney(BROWSER_JOURNEY_FIXTURE, { language: 'typescript' }).source,
				compileBrowserJourney(
					editBrowserJourney(BROWSER_JOURNEY_FIXTURE, [{ operation: 'remove', id: 's3' }]),
					{ language: 'typescript' },
				).source,
			].map((code) =>
				code
					.split(MODULE_STRING)
					.map((part, index) => (index % 2 === 1 ? part : part.replace(/\s+/gu, '')))
					.join('')
					.replace(/,(?=[)\]}])/gu, ''),
			)
			expect(guide).toBe(compiled)
			expect(shortened).not.toBe(compiled)
		})

		it('quotes the journey refusals the constants hold', async () => {
			const {
				BROWSER_JOURNEY_EMPTY_LISTING,
				BROWSER_JOURNEY_IDLE_REFUSAL,
				BROWSER_JOURNEY_READONLY_REFUSAL,
				BROWSER_JOURNEY_RECORDING_REFUSAL,
			} = await import('@src/core')
			for (const quoted of [
				BROWSER_JOURNEY_EMPTY_LISTING,
				BROWSER_JOURNEY_IDLE_REFUSAL,
				BROWSER_JOURNEY_READONLY_REFUSAL,
				BROWSER_JOURNEY_RECORDING_REFUSAL,
			])
				expect(files[GUIDE_SPEC]).toContain(`\`${quoted}\``)
		})
	})

	// The guide's Contract records that the in-page face never replaces `alert`, `confirm`, or

	// `prompt`, so a click that opens one blocks the driven document. The control proves the
	// pattern catches the override it guards against.
	it('assigns no page dialog function in the in-page face', () => {
		expect(DIALOG_OVERRIDE.test('window.alert = () => undefined')).toBe(true)
		expect(DIALOG_OVERRIDE.test("Object.defineProperty(view, 'confirm', { value })")).toBe(true)
		const overriding = Object.entries(files)
			.filter(([path]) => path.startsWith('src/browser/'))
			.filter(([, code]) => DIALOG_OVERRIDE.test(code))
			.map(([path]) => path)
		expect(overriding).toEqual([])
	})

	for (const { entry, guide, source } of rows) {
		describe(`${entry.concept}`, () => {
			it('uses only listed fence languages', () => {
				expect(report.fences.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('extracts a non-empty documented surface', () => {
				expect(guide.surface().length).toBeGreaterThan(0)
			})
			it('re-exports every direct declaration that is not named internal', () => {
				const stranded = findMissingSymbols(source.exports(), source.surface())
				expect(stranded.filter((key) => !INTERNAL.includes(key))).toEqual([])
			})
			it('names no symbol internal that the barrel already exports', () => {
				const stranded = findMissingSymbols(source.exports(), source.surface())
				expect(INTERNAL.filter((key) => !stranded.includes(key))).toEqual([])
			})
			it('re-exports only direct declarations', () => {
				expect(findMissingSymbols(source.surface(), source.exports())).toEqual([])
			})
			it('documents every barrel export', () => {
				expect(findMissingSymbols(source.surface(), guide.surface())).toEqual([])
			})
			it('documents only barrel exports', () => {
				expect(findMissingSymbols(guide.surface(), source.surface())).toEqual([])
			})

			it('exposes no hidden module-scope declarations', () => {
				expect(source.hidden().map(computeSymbolKey)).toEqual([])
			})

			for (const group of guide.methods()) {
				const members = source.methods(group.interface).map((method) => method.name)
				const documented = group.methods.map((method) => method.name)
				const entity = group.interface.replace(/Interface$/, '')
				describe(`${group.interface}`, () => {
					it('documents at least one method', () => {
						expect(group.methods.length).toBeGreaterThan(0)
					})
					it('documents every interface method', () => {
						expect(findMissing(members, documented)).toEqual([])
					})
					it('documents no phantom method', () => {
						expect(findMissing(documented, members)).toEqual([])
					})
					it(`${entity} exposes no undocumented method`, () => {
						const extra =
							entity === group.interface
								? []
								: findMissing(
										source.methods(entity).map((method) => method.name),
										documented,
									)
						expect(extra).toEqual([])
					})
				})
			}

			it('keeps behavioral interfaces and implementing classes in parity', () => {
				expect(report.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			// The equality gate: a `Summary` cell against its export's description paragraph, a
			// titled fence against the `@example` of that title. `findDrift` owns the comparison
			// and names both sides; converge the two sides through the native entry, never by
			// weakening this assertion. `findDrift` pairs an example only where a title is
			// present on both sides, so an untitled `@example` block is outside this case. Each
			// collected line is the spec, the key, and each side's text or `absent` — the same
			// worklist the native entry prints, so a failure here is read the way that command's
			// output is.
			it('keeps every compared summary and example equal to its source', () => {
				expect(report.drift.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('documents an example for every Surface function', () => {
				expect(report.examples.functions.filter((finding) => finding.spec === entry.spec)).toEqual(
					[],
				)
			})

			it('documents an example for every method', () => {
				expect(report.examples.methods.filter((finding) => finding.spec === entry.spec)).toEqual([])
			})

			it('imports only real exports in every ```ts fence', () => {
				const fences = guide.fences().filter((fence) => fence.language === EXAMPLE_LANGUAGE)
				for (const fence of fences) {
					for (const { specifier, names } of extractFenceImports(fence.code)) {
						const imported = sources.source(specifier)
						if (imported === undefined) continue
						const surface = imported.surface().map((symbol) => symbol.name)
						expect(findMissing(names, surface)).toEqual([])
					}
				}
			})

			it('resolves every relative link', () => {
				const broken = guide
					.links()
					.filter((href) => !isExternalLink(href))
					.map((href) => resolveLink(entry.spec, href))
					.filter((path) => !source.exists(path))
				expect(broken).toEqual([])
			})
			it('links only to test files that exist', () => {
				const missing = guide
					.tests()
					.map((href) => resolveLink(entry.spec, href))
					.filter((path) => !source.exists(path))
				expect(missing).toEqual([])
			})
		})
	}
})
