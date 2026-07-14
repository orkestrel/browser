/**
 * BrowserCodegen tests.
 *
 * Uses real CDP browser connections. Actions are delivered by invoking the
 * `__scsrBrowserCodegen` runtime binding directly from page context, which
 * exercises the exact code path used by trusted DOM events without requiring
 * synthetic input dispatch.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { BrowserCodegenAction, BrowserInterface } from '@scsr/server'
import { launchTestBrowser } from '../../../setupServer.js'

// === Shared browser

let browser: BrowserInterface

beforeAll(async () => {
	browser = await launchTestBrowser()
}, 30_000)

afterAll(async () => {
	await browser.destroy()
})

// === Binding invocation helper

async function invokeBinding(
	page: Awaited<ReturnType<BrowserInterface['create']>>,
	payload: Readonly<Record<string, unknown>>,
): Promise<void> {
	const json = JSON.stringify(payload).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
	await page.evaluate(`globalThis.__scsrBrowserCodegen('${json}')`)
}

// === BrowserCodegen

describe('BrowserCodegen', () => {
	describe('start()', () => {
		it('attaches to a page and exposes the binding', async () => {
			const page = await browser.create({ url: 'data:text/html,<h1>codegen</h1>' })
			const codegen = await page.codegen()
			expect(codegen.started).toBe(true)

			const present = await page.evaluate('typeof globalThis.__scsrBrowserCodegen')
			expect(present).toBe('function')

			await page.close()
		})

		it('returns the same instance when called twice on a page', async () => {
			const page = await browser.create({ url: 'data:text/html,<h1>codegen</h1>' })
			const first = await page.codegen()
			const second = await page.codegen()
			expect(second).toBe(first)
			await page.close()
		})

		it('emits the start event once', async () => {
			let count = 0
			const page = await browser.create({ url: 'data:text/html,<h1>codegen</h1>' })
			const codegen = await page.codegen({
				on: {
					start: () => {
						count += 1
					},
				},
			})
			// Starting again is a no-op
			await codegen.start()
			expect(count).toBe(1)
			await page.close()
		})
	})

	describe('action capture', () => {
		it('records click payloads delivered through the binding', async () => {
			const recorded: BrowserCodegenAction[] = []
			const page = await browser.create({ url: 'data:text/html,<button id="b">B</button>' })
			const codegen = await page.codegen({
				on: {
					action: (action) => {
						recorded.push(action)
					},
				},
			})

			await invokeBinding(page, { type: 'click', selector: '#b', timestamp: 1 })

			expect(recorded).toHaveLength(1)
			expect(recorded[0]).toEqual({ type: 'click', selector: '#b', timestamp: 1 })
			expect(codegen.actions()).toHaveLength(1)

			await page.close()
		})

		it('collapses consecutive fills on the same selector', async () => {
			const page = await browser.create({ url: 'data:text/html,<input id="x" />' })
			const codegen = await page.codegen()

			await invokeBinding(page, { type: 'fill', selector: '#x', value: 'a', timestamp: 1 })
			await invokeBinding(page, { type: 'fill', selector: '#x', value: 'ab', timestamp: 2 })
			await invokeBinding(page, { type: 'fill', selector: '#x', value: 'abc', timestamp: 3 })

			const actions = codegen.actions()
			expect(actions).toHaveLength(1)
			expect(actions[0]).toEqual({ type: 'fill', selector: '#x', value: 'abc', timestamp: 3 })

			await page.close()
		})

		it('drops malformed payloads', async () => {
			const page = await browser.create({ url: 'data:text/html,<h1>ok</h1>' })
			const codegen = await page.codegen()

			await page.evaluate("globalThis.__scsrBrowserCodegen('not json')")
			await page.evaluate("globalThis.__scsrBrowserCodegen(JSON.stringify({ type: 'unknown' }))")

			expect(codegen.actions()).toHaveLength(0)

			await page.close()
		})

		it('records a navigate action for main-frame navigations', async () => {
			const page = await browser.create({ url: 'data:text/html,<h1>first</h1>' })
			const codegen = await page.codegen()

			await page.navigate('data:text/html,<h1>second</h1>')

			const actions = codegen.actions()
			const navigates = actions.filter((a) => a.type === 'navigate')
			expect(navigates.length).toBeGreaterThan(0)
			expect(navigates[navigates.length - 1]?.type).toBe('navigate')

			await page.close()
		})
	})

	describe('script()', () => {
		it('compiles the recorded actions into runnable TypeScript', async () => {
			const page = await browser.create({ url: 'data:text/html,<input id="x" />' })
			const codegen = await page.codegen()

			await invokeBinding(page, { type: 'click', selector: '#x', timestamp: 1 })
			await invokeBinding(page, {
				type: 'fill',
				selector: '#x',
				value: 'hello',
				timestamp: 2,
			})

			const script = codegen.script()
			expect(script).toContain("import { createBrowser } from '@scsr/server'")
			expect(script).toContain("await page.click('#x')")
			expect(script).toContain("await page.fill('#x', 'hello')")

			await page.close()
		})

		it('accepts script emission options', async () => {
			const page = await browser.create({ url: 'data:text/html,<h1>opts</h1>' })
			const codegen = await page.codegen()

			await invokeBinding(page, { type: 'click', selector: '#x', timestamp: 1 })

			const body = codegen.script({ wrap: false })
			expect(body).toBe("await page.click('#x')")

			await page.close()
		})
	})

	describe('clear()', () => {
		it('empties the action log and emits clear', async () => {
			let cleared = 0
			const page = await browser.create({ url: 'data:text/html,<h1>x</h1>' })
			const codegen = await page.codegen({
				on: {
					clear: () => {
						cleared += 1
					},
				},
			})

			await invokeBinding(page, { type: 'click', selector: '#x', timestamp: 1 })
			expect(codegen.actions()).toHaveLength(1)

			codegen.clear()
			expect(codegen.actions()).toHaveLength(0)
			expect(cleared).toBe(1)

			await page.close()
		})
	})

	describe('stop()', () => {
		it('detaches listeners and returns the snapshot', async () => {
			const page = await browser.create({ url: 'data:text/html,<h1>stop</h1>' })
			const codegen = await page.codegen()

			await invokeBinding(page, { type: 'click', selector: '#a', timestamp: 1 })
			const snapshot = await codegen.stop()

			expect(snapshot).toHaveLength(1)
			expect(codegen.started).toBe(false)

			// Further binding calls must not append
			await invokeBinding(page, { type: 'click', selector: '#b', timestamp: 2 })
			expect(codegen.actions()).toHaveLength(1)

			await page.close()
		})

		it('is a no-op when never started', async () => {
			const page = await browser.create({ url: 'data:text/html,<h1>nop</h1>' })
			const codegen = await page.codegen()
			await codegen.stop()
			const snapshot = await codegen.stop()
			expect(snapshot).toEqual([])
			await page.close()
		})
	})

	describe('destroy()', () => {
		it('stops the recorder and clears the log', async () => {
			const page = await browser.create({ url: 'data:text/html,<h1>destroy</h1>' })
			const codegen = await page.codegen()

			await invokeBinding(page, { type: 'click', selector: '#x', timestamp: 1 })
			await codegen.destroy()

			expect(codegen.started).toBe(false)
			expect(codegen.actions()).toEqual([])

			await page.close()
		})
	})

	describe('BrowserPage.close()', () => {
		it('tears down the codegen before closing the target', async () => {
			const page = await browser.create({ url: 'data:text/html,<h1>close</h1>' })
			const codegen = await page.codegen()
			await invokeBinding(page, { type: 'click', selector: '#x', timestamp: 1 })

			await page.close()
			expect(codegen.started).toBe(false)
		})
	})
})
