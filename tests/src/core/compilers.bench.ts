import { expect, it } from 'vitest'
import { chromium } from 'playwright'
import { requireValue } from '@orkestrel/test'
import { BROWSER_RESULT_LIMIT, compileReadFunction } from '@src/core'
import { CAPTURE_INDEXED_WALK, CAPTURE_TABLE_SIZES } from '../../setup.js'
import { createFixtureServer, requireDocumentBundle } from '../../setupServer.js'
import { requireSystemBrowser } from '../../setupService.js'

it('capture sibling traversal against indexed traversal on large data tables', async (context) => {
	const measurement = context.bench(
		'capture sibling traversal against indexed traversal on large data tables',
		{},
		async () => {
			requireDocumentBundle()
			const fixtures = await createFixtureServer()
			try {
				const browser = await chromium.launch({
					executablePath: requireSystemBrowser().executable,
					headless: true,
				})
				try {
					const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
					await page.goto(fixtures.url('/document'))
					const source = compileReadFunction()
					const start = source.indexOf('\n\t\t\t\t\tthis.#element = live.lastElementChild')
					const end = source.indexOf('\n\t\t\t\t\tcontinue\n\t\t\t\t}', start)
					if (start <= 0 || end <= start) throw new Error('Capture traversal control did not match')
					const indexed =
						source.slice(0, start) + '\n\t\t\t' + CAPTURE_INDEXED_WALK + source.slice(end)
					for (const rows of CAPTURE_TABLE_SIZES) {
						const markup = Array.from(
							{ length: rows },
							(_, index) =>
								`<div role="row" style="display:flex;visibility:visible"><span>Order ${index}</span><span>Acme</span><span>Pending</span><span>12 units</span><span>North</span><span>October</span><span>Standard</span><button>Edit</button></div>`,
						).join('\n')
						for (const collapsed of [false, true]) {
							await page.evaluate(
								(html) => {
									document.body.innerHTML = html
								},
								collapsed
									? `<details><summary>Orders</summary>${markup}</details>`
									: `<div role="table" style="visibility:hidden">${markup}</div>`,
							)
							const readings: unknown = await page.evaluate(`(async () => {
							const { readBrowserCapture } = await import('/dist/src/browser/index.js')
							const indexed = ${indexed}
							const compiled = ${source}
							const expected = readBrowserCapture(document.documentElement)
							if (!expected.html.includes(${JSON.stringify(collapsed ? 'Orders' : `Order ${rows - 1}`)})) throw new Error('Capture benchmark lost its fixture')
							const results = []
							for (const placement of ['DOM', 'compiled']) {
								const samples = { indexed: [], siblings: [] }
								for (const round of Array.prototype.keys.call({ length: 20 })) {
									for (const candidate of placement === 'DOM' ? ['siblings'] : round % 2 === 0 ? ['indexed', 'siblings'] : ['siblings', 'indexed']) {
										const start = performance.now()
										const result = candidate === 'indexed' ? indexed() : placement === 'DOM' ? readBrowserCapture(document.documentElement) : compiled()
										if ((candidate === 'indexed' || placement === 'compiled') && JSON.stringify(result).length > ${BROWSER_RESULT_LIMIT}) throw new Error('Capture limit')
										const elapsed = performance.now() - start
										if (JSON.stringify(result) !== JSON.stringify(expected)) throw new Error('Capture benchmark changed the output')
										if (round >= 3) samples[candidate].push(elapsed)
									}
								}
								for (const [candidate, values] of Object.entries(samples)) {
									if (values.length === 0) continue
									values.sort((left, right) => left - right)
									results.push({ placement, candidate, rows: ${rows}, collapsed: ${collapsed}, median: values[8], q1: values[4], q3: values[12], samples: values })
								}
							}
							return results
						})()`)
							console.log('Capture benchmark', JSON.stringify(requireValue(readings)))
							expect(readings).toBeDefined()
						}
					}
				} finally {
					await browser.close()
				}
			} finally {
				await fixtures.destroy()
			}
		},
	)
	await measurement.run({ iterations: 1, time: 0, warmupIterations: 0, warmupTime: 0 })
})
