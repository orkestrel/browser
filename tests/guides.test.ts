// The consumer-side guides-parity drop-in: runs `@orkestrel/guide`'s checks against
// this repo's own `guides/README.md` manifest. The constants that follow preserve this
// package's own parity policy.

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
	'class BrowserDialog',
	'class BrowserDownload',
	'class BrowserFileChooser',
	'class BrowserHandle',
	'class BrowserNavigationRecord',
	'class BrowserRegistry',
	'class BrowserRoute',
	'class BrowserWorker',
])
/** The heading every fence driving the toolset with a small model sits under. */
const SMALL_MODEL_TITLE = 'Drive a page with a small model'
/**
 * The system prompt the store proof in `@orkestrel/ollama` runs with, its
 * `STORE_SYSTEM_PROMPT` constant transcribed.
 */
const SMALL_MODEL_PROMPT =
	'You control a web browser with tools and must call a tool before you answer. ' +
	'The first message shows the page as look returns it; references such as e4 name its elements. ' +
	'To learn a fact, call read with what set to your question; when its result ends by naming an offset, call read again with that offset. ' +
	'To search, call type with the search box reference, the words, and submit true. ' +
	'To press a button or follow a link, call click with its reference from the latest result. Never invent a reference. ' +
	'If text you expect has not appeared, call wait once. ' +
	'When the task is done, answer in one short sentence.'
/** The toolset and seeding lines of the Surface fence of that title, transcribed byte for byte. */
const SMALL_MODEL_LINES: readonly string[] = Object.freeze([
	'const toolset = createBrowserToolset(page, { tools: createToolManager() })',
	'await toolset.start()',
	"toolset.tools.tools().map((tool) => tool.name) // ['look', 'read', 'click', 'type', 'press', 'navigate', 'wait']",
	"const seeded = await toolset.tools.execute({\n\tid: 'seed',\n\tname: 'look',\n\targuments: { what: 'the page' },\n})",
	'const view = seeded.success ? String(seeded.value) : seeded.error',
	'\tcontent: `What does the Alpine Kettle cost?\\n\\nThe browser shows this page:\\n${view}`,',
])
/** The receipt the guide's Tools section quotes for a `look` call that carries `ref`. */
const UNADVERTISED_RECEIPT = 'The look tool takes no ref parameter; call look with what.'
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

	it('manifest lists at least one guide', () => {
		expect(report.input).toEqual([])
		expect(rows.length).toBeGreaterThan(0)
		expect(own.entry.spec).toBe(GUIDE_SPEC)
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
				const declared = /const system =\n((?:\t'[^'\n]*'(?: \+)?\n)+)/.exec(fence.code)?.[1] ?? ''
				const literals = [...declared.matchAll(/'([^'\n]*)'/g)].map((match) => match[1] ?? '')
				expect(literals.join('')).toBe(SMALL_MODEL_PROMPT)
			}
		})

		it('carries the transcribed toolset lines in the Surface fence', () => {
			for (const line of SMALL_MODEL_LINES) expect(fences[0]?.code).toContain(line)
		})

		it('lists the seven tools its comment claims and seeds the look view over a real page', async () => {
			const { createBrowserElementFixture } = await import('./setup.js')
			const { createBrowserToolset } = await import('@src/core')
			const { createToolManager } = await import('@orkestrel/tool')
			const { client, page } = await createBrowserElementFixture()
			try {
				const toolset = createBrowserToolset(page, { tools: createToolManager() })
				await toolset.start()
				expect(toolset.tools.tools().map((tool) => tool.name)).toEqual([
					'look',
					'read',
					'click',
					'type',
					'press',
					'navigate',
					'wait',
				])
				const seeded = await toolset.tools.execute({
					id: 'seed',
					name: 'look',
					arguments: { what: 'the page' },
				})
				expect(seeded.success ? String(seeded.value) : seeded.error).toMatch(
					/^page "[^"\n]*" https:\/\/example\.test\/cart\n/,
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
				name: 'look',
				arguments: { what: 'the cart', ref: 'e1' },
			})
			expect(result).toMatchObject({ success: false, error: UNADVERTISED_RECEIPT })
			expect(transport.sent.length).toBe(sent)
			await toolset.destroy()
		} finally {
			await client.close()
		}
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
