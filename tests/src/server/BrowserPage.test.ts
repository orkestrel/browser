/**
 * BrowserPage tests.
 *
 * Uses real CDP browser connections — no mocks.
 * Covers navigation, content extraction, screenshots,
 * element interaction, and edge cases.
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

// === BrowserPage

describe('BrowserPage', () => {
	describe('navigate()', () => {
		it('changes the page URL', async () => {
			const page = await browser.create()
			await page.navigate('data:text/html,<h1>Navigated</h1>')
			expect(page.url).toContain('data:text/html')
			await page.close()
		})

		it('respects condition option: load', async () => {
			const page = await browser.create()
			await page.navigate('data:text/html,<h1>Load</h1>', { condition: 'load' })
			expect(page.url).toContain('data:text/html')
			await page.close()
		})

		it('respects condition option: domcontentloaded', async () => {
			const page = await browser.create()
			await page.navigate('data:text/html,<h1>DOM</h1>', { condition: 'domcontentloaded' })
			expect(page.url).toContain('data:text/html')
			await page.close()
		})

		it('respects timeout option', async () => {
			const page = await browser.create()
			await page.navigate('data:text/html,<h1>Timeout</h1>', { timeout: 10_000 })
			expect(page.url).toContain('data:text/html')
			await page.close()
		})
	})

	describe('title()', () => {
		it('returns the document title', async () => {
			const page = await browser.create({
				url: 'data:text/html,<html><head><title>Test Title</title></head><body></body></html>',
			})
			expect(await page.title()).toBe('Test Title')
			await page.close()
		})

		it('returns empty string for page without title', async () => {
			const page = await browser.create({
				url: 'data:text/html,<html><body>No Title</body></html>',
			})
			expect(await page.title()).toBe('')
			await page.close()
		})
	})

	describe('content()', () => {
		it('returns url, title, html, and text', async () => {
			const page = await browser.create({
				url: 'data:text/html,<html><head><title>Content Test</title></head><body><p>Hello World</p></body></html>',
			})
			const result = await page.content()
			expect(result.title).toBe('Content Test')
			expect(result.html).toContain('<p>Hello World</p>')
			expect(result.text).toContain('Hello World')
			expect(typeof result.url).toBe('string')
			await page.close()
		})

		it('extracts visible text without markup', async () => {
			const page = await browser.create({
				url: 'data:text/html,<body><div>Visible <span>Text</span></div></body>',
			})
			const result = await page.content()
			expect(result.text).toContain('Visible')
			expect(result.text).toContain('Text')
			expect(result.text).not.toContain('<div>')
			await page.close()
		})
	})

	describe('screenshot()', () => {
		it('returns PNG bytes by default', async () => {
			const page = await browser.create({
				url: 'data:text/html,<h1>Screenshot</h1>',
			})
			const result = await page.screenshot()
			expect(result.bytes).toBeInstanceOf(Uint8Array)
			expect(result.bytes.length).toBeGreaterThan(0)
			// PNG magic bytes
			expect(result.bytes[0]).toBe(137)
			expect(result.bytes[1]).toBe(80)
			expect(result.bytes[2]).toBe(78)
			expect(result.bytes[3]).toBe(71)
			expect(result.path).toBeUndefined()
			await page.close()
		})

		it('returns JPEG bytes with jpeg type', async () => {
			const page = await browser.create({
				url: 'data:text/html,<h1>JPEG Test</h1>',
			})
			const result = await page.screenshot({ type: 'jpeg', quality: 80 })
			expect(result.bytes).toBeInstanceOf(Uint8Array)
			// JPEG magic bytes: FF D8
			expect(result.bytes[0]).toBe(0xff)
			expect(result.bytes[1]).toBe(0xd8)
			await page.close()
		})
	})

	describe('click()', () => {
		it('clicks a real element', async () => {
			const page = await browser.create({
				url: "data:text/html,<button id='btn' onclick=\"document.title='clicked'\">Click Me</button>",
			})
			await page.click('#btn')
			expect(await page.title()).toBe('clicked')
			await page.close()
		})
	})

	describe('fill()', () => {
		it('fills an input field', async () => {
			const page = await browser.create({
				url: 'data:text/html,<input id="name" type="text" />',
			})
			await page.fill('#name', 'hello world')
			const value = await page.evaluate('document.getElementById("name").value')
			expect(value).toBe('hello world')
			await page.close()
		})
	})

	describe('select()', () => {
		it('selects a value in a select element', async () => {
			const page = await browser.create({
				url: 'data:text/html,<select id="sel"><option value="a">A</option><option value="b">B</option></select>',
			})
			await page.select('#sel', ['b'])
			const value = await page.evaluate('document.getElementById("sel").value')
			expect(value).toBe('b')
			await page.close()
		})
	})

	describe('evaluate()', () => {
		it('executes a JavaScript expression', async () => {
			const page = await browser.create()
			const result = await page.evaluate('1 + 1')
			expect(result).toBe(2)
			await page.close()
		})

		it('evaluates string expressions', async () => {
			const page = await browser.create()
			const result = await page.evaluate('"hello".toUpperCase()')
			expect(result).toBe('HELLO')
			await page.close()
		})

		it('accesses the DOM', async () => {
			const page = await browser.create({
				url: 'data:text/html,<h1>DOM Access</h1>',
			})
			const result = await page.evaluate('document.querySelector("h1").textContent')
			expect(result).toBe('DOM Access')
			await page.close()
		})
	})

	describe('wait()', () => {
		it('waits for an element to appear', async () => {
			const page = await browser.create({
				url: 'data:text/html,<div id="target">Present</div>',
			})
			await expect(page.wait('#target')).resolves.toBeUndefined()
			await page.close()
		})
	})

	describe('frame()', () => {
		it('returns undefined for non-existent frame', async () => {
			const page = await browser.create()
			const child = page.frame('does-not-exist')
			expect(child).toBeUndefined()
			await page.close()
		})
	})

	describe('frames()', () => {
		it('returns empty array for MVP', async () => {
			const page = await browser.create()
			const frames = page.frames()
			expect(Array.isArray(frames)).toBe(true)
			expect(frames.length).toBe(0)
			await page.close()
		})
	})

	describe('close()', () => {
		it('closes the page', async () => {
			const page = await browser.create()
			expect(page.closed).toBe(false)
			await page.close()
			expect(page.closed).toBe(true)
		})
	})
})
