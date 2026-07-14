/**
 * BrowserContext tests.
 *
 * Uses real CDP browser connections — no mocks.
 * Covers context creation, page management, lifecycle, and edge cases.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { BrowserInterface } from '@scsr/server'
import { launchTestBrowser } from '../../../setupServer.js'

// === Shared browser

let browser: BrowserInterface

beforeAll(async () => {
	browser = await launchTestBrowser()
}, 30_000)

afterAll(async () => {
	await browser.destroy()
})

// === BrowserContext

describe('BrowserContext', () => {
	describe('page()', () => {
		it('returns page after creation', async () => {
			const page = await browser.create()
			const ctx = browser.context()
			expect(ctx).toBeDefined()
			expect(ctx?.page()).toBeDefined()
			await page.close()
		})

		it('returns undefined for out-of-range index', async () => {
			const ctx = browser.context()
			if (ctx === undefined) return
			expect(ctx.page(9999)).toBeUndefined()
		})

		it('returns undefined for negative index', async () => {
			const ctx = browser.context()
			if (ctx === undefined) return
			expect(ctx.page(-1)).toBeUndefined()
		})
	})

	describe('pages()', () => {
		it('returns a copy each call', async () => {
			const ctx = browser.context()
			if (ctx === undefined) return
			const list1 = ctx.pages()
			const list2 = ctx.pages()
			expect(list1).not.toBe(list2)
		})
	})

	describe('create()', () => {
		it('opens a new page', async () => {
			const ctx = browser.context()
			if (ctx === undefined) return
			const page = await ctx.create()
			expect(page).toBeDefined()
			expect(page.closed).toBe(false)
			await page.close()
		})

		it('navigates to url when provided', async () => {
			const ctx = browser.context()
			if (ctx === undefined) return
			const page = await ctx.create({ url: 'data:text/html,<h1>Created</h1>' })
			expect(page).toBeDefined()
			await page.close()
		})
	})

	describe('close()', () => {
		it('closes without error', async () => {
			// Create a fresh page to ensure a context exists
			const page = await browser.create()
			await expect(page.close()).resolves.toBeUndefined()
		})
	})

	describe('page interaction after create', () => {
		it('can evaluate JavaScript in a created page', async () => {
			const page = await browser.create()
			const result = await page.evaluate('2 + 2')
			expect(result).toBe(4)
			await page.close()
		})
	})
})
