import { describe, expect, it } from 'vitest'
import { isBrowserDocument } from '@src/browser'
import { createProbeDocument, readBrowserFixtureBase } from '../../setupBrowser.js'

describe('isBrowserDocument', () => {
	it('admits the page document and a probe document', () => {
		expect(isBrowserDocument(document)).toBe(true)
		expect(isBrowserDocument(createProbeDocument('<p>probe</p>'))).toBe(true)
	})

	it('refuses null and a plain object', () => {
		expect(isBrowserDocument(null)).toBe(false)
		expect(isBrowserDocument({ defaultView: window })).toBe(false)
	})

	it('refuses a document without a default view', () => {
		expect(isBrowserDocument(document.implementation.createHTMLDocument('detached'))).toBe(false)
	})
})

describe('readBrowserFixtureBase', () => {
	it('reads a loopback origin the fixture server answers', async () => {
		const base = readBrowserFixtureBase()
		expect(base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
		expect((await fetch(base + '/')).status).toBe(200)
	})
})
