/**
 * Live-browser proofs for the DOM placement served from the built `dist/src/browser` bundle.
 *
 * The fixture server's `/document` page imports the bundle through an import map, installs the
 * WebMCP registry double, and publishes `createDocumentToolset({ document, own: true, source })`
 * over its own document on `window.documentToolset`. Each case reads that toolset's results back
 * through `page.evaluate` and compares them with the CDP outline and a CDP toolset over the same
 * page. The bundle is a hard precondition: `requireDocumentBundle` throws naming `npm run build`
 * before a browser launches. The browser is the one `tests/setupService.ts` resolves, launched
 * once for the file; every page a case opens is closed after it.
 *
 * One case is an expected failure: the DOM outline skips a `select` element's subtree, so its
 * `option` rows, which the CDP outline lists under the combobox, are missing from the DOM set.
 * Its block establishes the page, the select, both outlines, and the CDP membership before the one
 * inverted comparison, so a load or reader failure fails the block instead.
 */

import type { BrowserInterface } from '@src/server'
import type { BrowserPageInterface, BrowserToolsetInterface } from '@src/core'
import type { FixtureServerInterface } from '../setupServer.js'
import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { createBrowser } from '@src/server'
import { createBrowserToolset } from '@src/core'
import { compileReadFunction } from '@src/core'
import { renderHTML } from '@orkestrel/html'
import { chromium } from 'playwright'
import { createToolManager } from '@orkestrel/tool'
import { createTeardown, requireValue, waitForCondition } from '@orkestrel/test'
import {
	createFixtureServer,
	createTempDirectory,
	requireDocumentBundle,
	reservePort,
} from '../setupServer.js'
import {
	collectOutlinePairs,
	collectOutlineEntries,
	extractOutlineRows,
	requireDocumentToolset,
	requireOutlineReference,
	requireSystemBrowser,
	requireToolText,
	SERVICE_BROWSER_ARGS,
	SERVICE_EDITABLE_HTML,
	SERVICE_TOGGLE_HTML,
} from '../setupService.js'
import {
	BROWSER_JOURNEY_FRAME_HTML,
	BROWSER_JOURNEY_FRAME_JOURNEY,
	CAPTURE_CASES,
	RENDERED_PAGE,
	RENDERED_SHADOW_EXPRESSION,
} from '../setup.js'

const REAL_BROWSER_EXECUTABLE = requireSystemBrowser().executable

const DOCUMENT_LOOK =
	"documentToolset.tools.execute({ id: 'look', name: 'look', arguments: { what: 'the gift options' } })"

describe('createDocumentToolset served from dist/src/browser against CDP on the same page', () => {
	const teardown = createTeardown()
	let fixtures: FixtureServerInterface
	let browser: BrowserInterface
	let port: number

	beforeAll(async () => {
		requireDocumentBundle()
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
			args: [...SERVICE_BROWSER_ARGS],
			cdp: { port },
			timeout: 20_000,
		})
		teardown.add(() => launched.destroy())
		await launched.connect()
		browser = launched
	})

	afterAll(async () => {
		await teardown.destroy()
	})

	describe('on a fresh document page', () => {
		const toolsets: BrowserToolsetInterface[] = []
		let page: BrowserPageInterface

		beforeEach(async () => {
			page = await browser.create({ url: fixtures.url('/document') })
			await requireDocumentToolset(page)
		})

		afterEach(async () => {
			for (const toolset of toolsets.splice(0)) await toolset.destroy().catch(() => undefined)
			await page.close().catch(() => undefined)
		})

		it.each(CAPTURE_CASES)(
			'captures $name through public CDP and DOM reads',
			async ({ html, edit, text }) => {
				await page.evaluate(
					`(()=>{document.body.innerHTML=${JSON.stringify(html)};${edit};return true})()`,
				)
				const cdp = await page.read()
				const dom = await page.evaluate(
					`(async () => { const {createBrowserDOMView}=await import('/dist/src/browser/index.js');const view=createBrowserDOMView({document,own:true});try { const reading=await view.read();return [reading.markdown().text,reading.markdown({distill:false}).text,reading.text().text,reading.text({distill:false}).text].map(text=>text.replace(/\\s+/g,' ').trim()) } finally {view.destroy()} })()`,
				)
				expect(dom).toEqual([text, text, text, text])
				for (const distill of [true, false]) {
					expect(cdp.markdown({ distill }).text.replace(/\s+/g, ' ').trim()).toBe(text)
					expect(cdp.text({ distill }).text.replace(/\s+/g, ' ').trim()).toBe(text)
				}
				expect(renderHTML(cdp.html.document)).not.toMatch(
					/private-default|private-edited|hidden-payload|fakepath/,
				)
			},
		)

		it('captures direct roots, hidden ancestors, shadow hosts, and child frames', async () => {
			await page.evaluate(
				`(()=>{document.body.innerHTML=${JSON.stringify(RENDERED_PAGE)};${RENDERED_SHADOW_EXPRESSION};return true})()`,
			)
			for (const [css, expected] of [
				['#region', 'Region shown'],
				['#hidden-child', ''],
			]) {
				const element = requireValue((await page.elements.find({ css: requireValue(css) }))[0])
				expect((await element.read()).text().text.trim()).toBe(expected)
			}
			expect(
				await page.evaluate(
					`(${compileReadFunction()})(document.querySelector('#hidden-host').shadowRoot.querySelector('p')).html`,
				),
			).toBe('')
			await page.evaluate(
				`(()=>{document.body.innerHTML='<p>Outside text</p><button>Inside text</button>';return true})()`,
			)
			expect(
				(await requireValue((await page.elements.find({ css: 'button' }))[0]).read())
					.text()
					.text.trim(),
			).toBe('Inside text')
			await page.evaluate(
				`new Promise(resolve=>{const frame=document.createElement('iframe');frame.onload=()=>resolve(true);frame.srcdoc='<form>Frame prose<input value="Frame value"><input type="password" value="private-frame"><input type="hidden" value="hidden-payload"></form>';document.body.append(frame)})`,
			)
			const frame = requireValue(
				(await page.frames()).find((candidate) => candidate.parent !== undefined),
			)
			expect((await frame.read()).text().text.replace(/\s+/g, ' ').trim()).toBe(
				'Frame prose Frame value',
			)
			expect(renderHTML((await frame.read()).html.document)).not.toMatch(
				/private-frame|hidden-payload/,
			)
		})

		it('keeps read tool parity as a stylesheet-hidden panel becomes shown', async () => {
			await page.evaluate(
				`(()=>{document.body.innerHTML='<style>.toast:not(.show){display:none}</style><p>Public prose</p><div class="toast">Toast body dismissed</div>';return true})()`,
			)
			const tools = createToolManager()
			const toolset = createBrowserToolset(page, { tools })
			toolsets.push(toolset)
			await toolset.start()
			for (const shown of [false, true]) {
				await page.evaluate(`document.querySelector('.toast').classList.toggle('show',${shown})`)
				const cdp = requireToolText(
					await tools.execute({
						id: 'read',
						name: 'read',
						arguments: { what: 'the page', offset: 0 },
					}),
				)
				const dom = requireToolText(
					await page.evaluate(
						`documentToolset.tools.execute({id:'read',name:'read',arguments:{what:'the page',offset:0}})`,
					),
				)
				expect(dom).toBe(cdp)
				expect(cdp.includes('Toast body dismissed')).toBe(shown)
			}
		})

		it('omits a number during an invalid edit without substituting its placeholder', async () => {
			await page.evaluate(
				`document.body.innerHTML='<input type="number" placeholder="Guessed number">'`,
			)
			const connection = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
			const target = requireValue(
				connection
					.contexts()[0]
					?.pages()
					.find((candidate) => candidate.url() === page.url),
			)
			await target.locator('input').pressSequentially('1e')
			expect(
				await target
					.locator('input')
					.evaluate((element) => element instanceof HTMLInputElement && element.validity.badInput),
			).toBe(true)
			expect((await page.read()).text().text).toBe('')
			expect(
				await page.evaluate(
					`(async()=>{const {readBrowserCapture}=await import('/dist/src/browser/index.js');const {createBrowserReading}=await import('/dist/src/core/index.js');return createBrowserReading(readBrowserCapture(document.documentElement)).text().text})()`,
				),
			).toBe('')
		})

		it('imports inertly without requests, constructors, or live writes in both worlds', async () => {
			const connection = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
			const target = requireValue(
				connection
					.contexts()[0]
					?.pages()
					.find((candidate) => candidate.url() === page.url),
			)
			const cdp = await target.context().newCDPSession(target)
			try {
				await target.evaluate("import('/dist/src/browser/index.js')")
				await cdp.send('Network.enable')
				await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
				const requests: string[] = []
				const pending = new Set<string>()
				cdp.on('Network.requestWillBeSent', (event) => {
					requests.push(event.request.url)
					if (event.request.url.includes('/capture-')) pending.add(event.requestId)
				})
				cdp.on('Network.loadingFinished', (event) => pending.delete(event.requestId))
				cdp.on('Network.loadingFailed', (event) => pending.delete(event.requestId))
				await target.evaluate(
					`window.captureCount=0;customElements.define('capture-card',class extends HTMLElement{constructor(){super();window.captureCount++}})`,
				)
				const tree = await cdp.send('Page.getFrameTree')
				const world = await cdp.send('Page.createIsolatedWorld', {
					frameId: tree.frameTree.frame.id,
					worldName: 'capture-proof',
				})
				for (const contextId of [undefined, world.executionContextId]) {
					requests.length = 0
					await target.evaluate(
						`document.body.innerHTML='<img src="/capture-image"><img srcset="/capture-srcset 1x"><picture><source srcset="/capture-picture 1x"><img></picture><video src="/capture-video" poster="/capture-poster"></video><audio src="/capture-audio"></audio><input type="image" src="/capture-input"><object data="/capture-object"></object><link rel="preload" as="image" href="/capture-preload"><capture-card></capture-card>'.replaceAll('/capture-','/capture-${contextId ?? 'main'}-');window.captureMutations=0;window.captureObserver=new MutationObserver(records=>window.captureMutations+=records.length);captureObserver.observe(document,{subtree:true,childList:true,attributes:true,characterData:true})`,
					)
					await waitForCondition(
						'live capture fixture requests',
						() => requests.filter((url) => url.includes('/capture-')).length >= 9,
					)
					await waitForCondition('live capture fixture responses', () => pending.size === 0)
					await target.evaluate('captureMutations=0;captureObserver.takeRecords()')
					requests.length = 0
					const before = await target.evaluate(
						'({count:captureCount,html:document.documentElement.outerHTML})',
					)
					const expression =
						contextId === undefined
							? `(async()=>{const {readBrowserCapture}=await import('/dist/src/browser/index.js');return readBrowserCapture(document.documentElement).html.length})()`
							: `(${compileReadFunction()})().html.length`
					const capture = await cdp.send('Runtime.evaluate', {
						expression,
						awaitPromise: true,
						returnByValue: true,
						...(contextId === undefined ? {} : { contextId }),
					})
					expect(capture.exceptionDetails).toBeUndefined()
					await target.evaluate(
						`fetch('/capture-sentinel-${contextId ?? 'main'}').then(response=>response.text())`,
					)
					await waitForCondition(
						'post-capture sentinel response',
						() => requests.some((url) => url.includes('/capture-sentinel-')) && pending.size === 0,
					)
					expect(
						requests.filter(
							(url) => url.includes('/capture-') && !url.includes('/capture-sentinel-'),
						),
					).toEqual([])
					expect(
						await target.evaluate('({count:captureCount,html:document.documentElement.outerHTML})'),
					).toEqual(before)
					expect(
						await target.evaluate('captureMutations+captureObserver.takeRecords().length'),
					).toBe(0)
					await cdp.send('Runtime.evaluate', {
						expression: 'document.documentElement.cloneNode(true)',
						...(contextId === undefined ? {} : { contextId }),
					})
					await waitForCondition('active clone control request', () =>
						requests.some(
							(url) => url.includes('/capture-') && !url.includes('/capture-sentinel-'),
						),
					)
					expect(
						await target.evaluate('({count:captureCount,html:document.documentElement.outerHTML})'),
					).not.toEqual(before)
				}
			} finally {
				await cdp.detach()
			}
		})

		it('lists the same interactive (role, name) set in the DOM look as the CDP outline of the same page', async () => {
			const dom = requireToolText(await page.evaluate(DOCUMENT_LOOK))
			const cdp = (await page.elements.outline()).text

			expect(collectOutlinePairs(cdp)).toStrictEqual([
				'button "Apply"',
				'checkbox "Gift wrap"',
				'link "Delivery desk"',
				'textbox "Message"',
			])
			expect(collectOutlinePairs(dom)).toStrictEqual(collectOutlinePairs(cdp))
		})

		it('lists the same match rows in the DOM look as the CDP outline search of the same page', async () => {
			const what = 'Gift wrap checkbox'
			const cdp = await page.elements.outline({ search: what })
			expect(collectOutlinePairs(cdp.matches.join('\n'))).toStrictEqual(['checkbox "Gift wrap"'])
			const dom = requireToolText(
				await page.evaluate(
					`documentToolset.tools.execute({ id: 'look', name: 'look', arguments: { what: ${JSON.stringify(what)} } })`,
				),
			)
			const [block = ''] = dom.split('\n\npage "')
			const [header, ...rows] = block.split('\n')
			expect(header).toBe(`1 element matches ${JSON.stringify(what)}:`)
			expect(collectOutlinePairs(rows.join('\n'))).toStrictEqual(
				collectOutlinePairs(cdp.matches.join('\n')),
			)
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

		it('outlines editable regions by role and types into none of them, refusing the role="textbox" region UNTRUSTED and the rest by role', async () => {
			await page.evaluate(
				`(() => { document.querySelector('main').insertAdjacentHTML('beforeend', ${JSON.stringify(SERVICE_EDITABLE_HTML)}); return true })()`,
			)
			const look = requireToolText(await page.evaluate(DOCUMENT_LOOK))
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

			const refused = await page.evaluate(
				`documentToolset.tools.execute([${[notes, bold, coupon]
					.map(
						(reference) =>
							`{ id: '${reference}', name: 'type', arguments: { ref: '${reference}', text: 'kettle' } }`,
					)
					.join(', ')}])`,
			)
			expect(refused).toMatchObject([
				{
					success: false,
					error: `Element ${notes} is contenteditable, which an untrusted event cannot type into.`,
				},
				{
					success: false,
					error: `Element ${bold} button "Bold" takes no text; call click for a button.`,
				},
				{
					success: false,
					error: `Element ${coupon} button "Coupon" takes no text; call click for a button.`,
				},
			])
			expect(await page.evaluate("document.querySelector('[role=textbox]').textContent")).toBe('')
		})

		it('replays a one-step click journey naming a same-origin child-frame button to complete, setting the frame marker and not the page marker', async () => {
			await page.evaluate(
				`new Promise((resolve) => { const frame = document.createElement('iframe'); frame.onload = resolve; frame.srcdoc = ${JSON.stringify(BROWSER_JOURNEY_FRAME_HTML)}; document.body.append(frame) })`,
			)
			const run = await page.evaluate(
				`import('/dist/src/core/index.js').then(async ({ createBrowserReplay }) => {
					const run = await createBrowserReplay(documentToolset, { journey: ${JSON.stringify(BROWSER_JOURNEY_FRAME_JOURNEY)} }).execute()
					return { outcome: run.outcome, steps: run.steps.map((step) => [step.id, step.outcome, step.result]) }
				})`,
			)

			expect(run).toEqual({
				outcome: 'complete',
				steps: [
					[
						's1',
						'done',
						expect.stringMatching(
							/^Clicked e[1-9]\d* button "Save in frame"\. \(untrusted event\)$/u,
						),
					],
				],
			})
			expect(
				await page.evaluate(
					'document.querySelector("iframe").contentDocument.body.dataset.clicked',
				),
			).toBe('yes')
			expect(await page.evaluate('document.body.dataset.clicked ?? "none"')).toBe('none')
		})

		it('refuses a workspace without the built bundle before any page loads, naming npm run build', () => {
			const empty = createTempDirectory()

			expect(() => requireDocumentBundle(empty.path)).toThrow(
				'dist/src/browser/index.js and dist/src/core/index.js are absent; run npm run build',
			)
			expect(requireDocumentBundle()).toBeUndefined()
		})
	})

	describe('with toggle states appended to the document page', () => {
		let page: BrowserPageInterface
		let cdp: string
		let dom: string
		beforeAll(async () => {
			page = await browser.create({ url: fixtures.url('/document') })
			await requireDocumentToolset(page)
			await page.evaluate(
				`document.querySelector('main').insertAdjacentHTML('beforeend', ${JSON.stringify(SERVICE_TOGGLE_HTML)})`,
			)
			cdp = (await page.elements.outline()).text
			const entries = collectOutlineEntries(cdp)
			for (const entry of [
				'button "Toggle on" pressed=true',
				'button "Toggle off" pressed=false',
				'button "Toggle mixed" pressed=mixed',
				'button "Uppercase toggle" pressed=true',
				'button "Unknown toggle" pressed=true',
				'button "Spaced toggle" pressed=true',
				'button "Empty toggle"',
				'button "Undefined toggle"',
				'button "Mixed expansion" expanded=true',
				'button "Unknown expansion" expanded=true',
				'combobox "Native" value="Native chosen" expanded=false',
				'option "Native first" selected=false',
				'option "Native chosen" selected=true',
				'button "Disclosure" expanded=false',
				'link "Expanded link" expanded=true',
				'button "Plain toggle control"',
				'tab "Selected tab" selected=true',
				'tab "Unselected tab" selected=false',
				'tab "Default tab"',
				'treeitem "Selected treeitem" selected=true',
				'treeitem "Unselected treeitem" selected=false',
				'treeitem "Default treeitem"',
				'option "Selected option" selected=true',
				'option "Unselected option" selected=false',
				'option "Default option"',
				'option "Empty option"',
				'option "Undefined option"',
				'combobox "Override" value="Native false" expanded=false',
				'option "Native false" selected=false',
				'option "Native true" selected=true',
			]) {
				if (!entries.includes(entry)) throw new Error(`CDP state precondition missing: ${entry}`)
			}
			dom = requireToolText(await page.evaluate(DOCUMENT_LOOK))
		})
		afterAll(async () => {
			await page.close().catch(() => undefined)
		})
		it('keeps complete DOM rows equal to the CDP rows, including false and native overrides', () => {
			expect(collectOutlineEntries(dom)).toEqual(collectOutlineEntries(cdp))
		})
	})

	it('declares the lone tab selection difference between CDP and DOM', async () => {
		const page = await browser.create({ url: fixtures.url('/document') })
		try {
			await requireDocumentToolset(page)
			await page.evaluate(
				'document.querySelector("main").insertAdjacentHTML("beforeend", "<button role=tab>Lone tab</button>")',
			)
			expect(collectOutlineEntries((await page.elements.outline()).text)).toContain(
				'tab "Lone tab" selected=false',
			)
			const entries = collectOutlineEntries(requireToolText(await page.evaluate(DOCUMENT_LOOK)))
			expect(entries).toContain('tab "Lone tab"')
			expect(entries).not.toContain('tab "Lone tab" selected=false')
		} finally {
			await page.close()
		}
	})

	it('declares the native summary row difference between CDP and DOM', async () => {
		const page = await browser.create({ url: fixtures.url('/document') })
		try {
			await requireDocumentToolset(page)
			await page.evaluate(
				'document.querySelector("main").insertAdjacentHTML("beforeend", "<details><summary>Delivery details</summary>Delivery instructions</details>")',
			)
			expect(collectOutlineEntries((await page.elements.outline()).text)).toContain(
				'DisclosureTriangle "Delivery details" expanded=false',
			)
			const dom = requireToolText(await page.evaluate(DOCUMENT_LOOK))
			expect(dom).toContain('Delivery details')
			expect(extractOutlineRows(dom).filter((row) => row.name === 'Delivery details')).toEqual([])
		} finally {
			await page.close()
		}
	})

	it('declares the lone treeitem role and state difference between CDP and DOM', async () => {
		const page = await browser.create({ url: fixtures.url('/document') })
		try {
			await requireDocumentToolset(page)
			await page.evaluate(
				'document.querySelector("main").insertAdjacentHTML("beforeend", "<div role=treeitem aria-expanded=true aria-selected=false>Lone treeitem</div>")',
			)
			const { nodes } = await page.accessibility.snapshot()
			const text = nodes.find((node) => node.role === 'StaticText' && node.name === 'Lone treeitem')
			expect(text).toBeDefined()
			const item = nodes.find((node) => node.id === text?.parent)
			expect(item).toMatchObject({ role: 'generic' })
			expect(item?.properties).not.toHaveProperty('pressed')
			expect(item?.properties).not.toHaveProperty('expanded')
			expect(item?.properties).not.toHaveProperty('selected')
			const cdp = (await page.elements.outline()).text
			expect(cdp).toContain('Lone treeitem')
			expect(extractOutlineRows(cdp).filter((row) => row.name === 'Lone treeitem')).toEqual([])
			expect(collectOutlineEntries(requireToolText(await page.evaluate(DOCUMENT_LOOK)))).toContain(
				'treeitem "Lone treeitem" expanded=true selected=false',
			)
		} finally {
			await page.close()
		}
	})

	describe('with a select appended to the document page', () => {
		let page: BrowserPageInterface
		let dom: string
		let cdp: string

		// Establishes, outside the inverted comparison, the started page, the appended select, both
		// outlines, and the complete CDP membership with its two option rows; a failure of any of
		// them fails the block.
		beforeAll(async () => {
			page = await browser.create({ url: fixtures.url('/document') })
			await requireDocumentToolset(page)
			await page.evaluate(
				"(() => { const label = document.createElement('label'); label.append('Box ', document.createElement('select')); label.lastChild.append(new Option('Small'), new Option('Large')); document.querySelector('main').append(label); return true })()",
			)
			dom = requireToolText(await page.evaluate(DOCUMENT_LOOK))
			cdp = (await page.elements.outline()).text
			const membership = [
				'button "Apply"',
				'checkbox "Gift wrap"',
				'combobox "Box"',
				'link "Delivery desk"',
				'option "Large"',
				'option "Small"',
				'textbox "Message"',
			]
			const listed = collectOutlinePairs(cdp)
			if (JSON.stringify(listed) !== JSON.stringify(membership))
				throw new Error(
					`Precondition failed: the CDP outline lists ${JSON.stringify(listed)}, not ${JSON.stringify(membership)}`,
				)
		})

		afterAll(async () => {
			await page.close().catch(() => undefined)
		})

		// `BrowserDOMElementManager` skips a `select` element's subtree after its combobox row, so the
		// DOM look carries no `option` row, while the CDP outline lists one per option under it.
		it('lists the option rows of the select in the DOM look as the CDP outline does', () => {
			expect(collectOutlinePairs(dom)).toStrictEqual(collectOutlinePairs(cdp))
		})
	})
})
