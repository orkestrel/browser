import type { BrowserReadResult, BrowserReadingInterface } from '@src/core'
import { describe, expect, it } from 'vitest'
import { BrowserError, BrowserReading, createBrowserReading } from '@src/core'

const url = 'https://example.com/notes/'
const html =
	'<html><head><title>Field notes</title></head><body><nav><a href="/home">Section navigation</a></nav><main><h1>Field notes</h1><p>The paragraph the reader wants, with a <a href="/next">relative link</a>.</p></main><footer>Footer links</footer></body></html>'

// === BrowserReading

describe('BrowserReading', () => {
	it('carries the captured url and title and parses the html one time into its handle', () => {
		const reading = createBrowserReading({ url, title: 'Field notes', html })

		expect(reading).toBeInstanceOf(BrowserReading)
		expect(reading.url).toBe(url)
		expect(reading.title).toBe('Field notes')
		expect(reading.html.document.category).toBe('document')
		expect(reading.html).toBe(reading.html)
	})

	it('renders distilled Markdown that keeps the main paragraph and drops nav and footer', () => {
		const reading = createBrowserReading({ url, title: 'Field notes', html })

		expect(reading.markdown()).toEqual({
			text: '# Field notes\n\nThe paragraph the reader wants, with a [relative link](https://example.com/next).',
			offset: 0,
			total: 96,
		})
	})

	it('renders the whole document as Markdown with distill false', () => {
		const reading = createBrowserReading({ url, title: 'Field notes', html })
		const whole = reading.markdown({ distill: false }).text

		expect(whole).toContain('The paragraph the reader wants')
		expect(whole).toContain('[Section navigation](/home)')
		expect(whole).toContain('Footer links')
	})

	it('renders distilled plain text and the whole document as plain text with distill false', () => {
		const reading = createBrowserReading({ url, title: 'Field notes', html })

		expect(reading.text().text).toBe(
			'Field notes\nThe paragraph the reader wants, with a relative link.',
		)
		expect(reading.text({ distill: false }).text).toBe(
			'Field notes\nSection navigation\nField notes\nThe paragraph the reader wants, with a relative link.\nFooter links',
		)
	})

	it('slices a 10 000-character Markdown projection on line breaks with a constant total', () => {
		const paragraphs = Array.from(
			{ length: 132 },
			(_, index) => `<p>Paragraph ${index} ${'reads on '.repeat((index % 9) + 3)}</p>`,
		).join('')
		const reading = createBrowserReading({
			url,
			title: 'Long notes',
			html: `<main>${paragraphs}</main>`,
		})
		const whole = reading.markdown().text
		const slices: BrowserReadResult[] = []
		let offset = 0
		while (offset < whole.length) {
			const slice = reading.markdown({ offset, limit: 4_000 })
			slices.push(slice)
			offset = slice.offset + slice.text.length
		}

		expect(whole.length).toBeGreaterThanOrEqual(10_000)
		expect(whole.length).toBeLessThan(12_000)
		expect(slices.length).toBeGreaterThanOrEqual(3)
		expect(slices.map((slice) => slice.text).join('')).toBe(whole)
		expect(slices.every((slice) => slice.text.length <= 4_000)).toBe(true)
		expect(slices.every((slice) => slice.total === whole.length)).toBe(true)
		expect(slices.slice(0, -1).every((slice) => slice.text.endsWith('\n'))).toBe(true)
		expect(slices.at(-1)?.text.endsWith('\n')).toBe(false)
	})

	it('hard-cuts a projection with no line break at the limit', () => {
		const reading = createBrowserReading({
			url,
			title: 'One line',
			html: `<main><p>${'x'.repeat(10_000)}</p></main>`,
		})

		expect(reading.text({ limit: 4_000 }).text).toHaveLength(4_000)
		expect(reading.text({ offset: 8_000, limit: 4_000 })).toEqual({
			text: 'x'.repeat(2_000),
			offset: 8_000,
			total: 10_000,
		})
	})

	it('resolves relative links against the captured url only in the distilled projection', () => {
		const reading = createBrowserReading({ url: 'https://example.org/deep/page', title: '', html })

		expect(reading.markdown().text).toContain('(https://example.org/next)')
		expect(reading.markdown({ distill: false }).text).toContain('(/next)')
	})

	it('refuses an invalid slice bound with a browser error', () => {
		const reading = createBrowserReading({ url, title: 'Field notes', html })

		expect(() => reading.markdown({ offset: -1 })).toThrow(BrowserError)
		expect(() => reading.text({ limit: 0 })).toThrow(BrowserError)
	})

	it('reports stale once the navigation epoch advances past the one recorded at construction', () => {
		const epochs = [3]
		const reading: BrowserReadingInterface = createBrowserReading({
			url,
			title: 'Field notes',
			html,
			navigation: () => epochs[0] ?? 0,
		})

		expect(reading.stale).toBe(false)
		epochs[0] = 4
		expect(reading.stale).toBe(true)
	})

	it('reports stale at construction when the epoch recorded at capture already differs', () => {
		const reading = createBrowserReading({
			url,
			title: 'Field notes',
			html,
			epoch: 2,
			navigation: () => 3,
		})

		expect(reading.stale).toBe(true)
	})

	it('never reports stale without a navigation source', () => {
		const reading = createBrowserReading({ url, title: 'Field notes', html, epoch: 7 })

		expect(reading.stale).toBe(false)
	})
})
