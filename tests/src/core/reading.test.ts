import type { BrowserLine, BrowserPassage } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	BROWSER_READ_WIDTH,
	BROWSER_TOOL_LIMIT,
	renderBrowserLine,
	wrapBrowserLine,
	renderBrowserPassage,
	scanBrowserLines,
	renderBrowserFooter,
	validateBrowserLines,
} from '@src/core'

describe('line projection and whole windows', () => {
	it('wraps whitespace and hard tokens before numbering without splitting a code point', () => {
		const paragraph = 'An ordinary paragraph. '.repeat(50).trim()
		const ordinary = wrapBrowserLine({ spans: [{ category: 'text', text: paragraph }] })
		expect(ordinary.map(renderBrowserLine).join(' ')).toBe(paragraph)
		const token = '𐐷'.repeat(1200)
		const hard = wrapBrowserLine({ spans: [{ category: 'text', text: token }] })
		expect(
			hard
				.map(renderBrowserLine)
				.map((line) => line.replace(/^↳/, ''))
				.join(''),
		).toBe(token)
		for (const line of [...ordinary, ...hard].map(renderBrowserLine)) {
			expect(line.length).toBeLessThanOrEqual(BROWSER_READ_WIDTH)
			expect(line.isWellFormed()).toBe(true)
		}
		expect(hard.slice(1).every((line) => renderBrowserLine(line).startsWith('↳'))).toBe(true)
	})
	it('searches only text spans, uses best scores, Unicode words, and prefixes of at least four letters', () => {
		const lines: readonly BrowserLine[] = [
			{
				spans: [
					{ category: 'reference', text: 'e12345' },
					{ category: 'syntax', text: ' value="' },
					{ category: 'text', text: 'Cedar schedules 日本語' },
					{ category: 'syntax', text: '"' },
				],
			},
			{ spans: [{ category: 'text', text: '/delivery?season=winter' }] },
			{ spans: [{ category: 'text', text: 'Cedar schedule' }] },
		]
		expect(scanBrowserLines(lines, 'e12345 value')).toEqual([])
		expect(scanBrowserLines(lines, 'cedar schedule')).toEqual([1, 3])
		expect(scanBrowserLines(lines, 'deliver')).toEqual([2])
		expect(scanBrowserLines(lines, 'ced')).toEqual([])
		expect(scanBrowserLines(lines, '日本語')).toEqual([1])
		expect(scanBrowserLines(lines, 'cedar schedule', 2)).toEqual([3])
	})
	it('bounds metadata, matching numbers and complete rows together without changing addresses', () => {
		const lines: readonly BrowserLine[] = Array.from({ length: 120 }, () => ({
			spans: [{ category: 'text', text: 'Matching ' + '𐐷'.repeat(300) }],
		}))
		const passage: BrowserPassage = {
			url: 'https://example.test/' + 'u'.repeat(5000),
			title: '"'.repeat(5000),
			lines,
			from: 40,
			search: 'matching ' + 'a'.repeat(5000),
			changed: true,
			note: 'm'.repeat(5000),
			tabs: Array.from({ length: 100 }, (_, i) => ({
				id: 't' + i,
				title: 't'.repeat(500),
				url: 'https://example.test/',
				current: i === 0,
			})),
		}
		const window = renderBrowserPassage(passage, BROWSER_TOOL_LIMIT)
		expect(window.length).toBeLessThanOrEqual(BROWSER_TOOL_LIMIT)
		expect(window).toContain('\n40: Matching')
		expect(window).not.toContain('\n39:')
		expect(window).toContain('more tabs omitted')
		expect(window).toContain('and 31 more; add words to narrow')
		expect(window).toContain('changed')
		expect(window).toMatch(/call read with from \d+ for more\]$/)
	})
	it('renders each footer form, clamps at the end and refuses invalid ranges', () => {
		expect(renderBrowserFooter(1, 2, 2)).toBe('[lines 1–2 of 2; the whole page]')
		expect(renderBrowserFooter(2, 2, 2)).toBe('[lines 2–2 of 2; 1 above; end of page]')
		expect(renderBrowserFooter(1, 1, 2)).toBe(
			'[lines 1–1 of 2; 1 below; call read with from 2 for more]',
		)
		expect(renderBrowserFooter(1, 0, 0)).toBe('[empty page; the whole page]')
		for (const from of [0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
			expect(() => validateBrowserLines(from)).toThrow(/line|Line|from|to/)
		expect(() => validateBrowserLines(2, 1)).toThrow(/line|Line|from|to/)
		expect(() => validateBrowserLines(3, undefined, 2)).toThrow(/line|Line|from|to/)
		const lines: readonly BrowserLine[] = [{ spans: [{ category: 'text', text: 'Only row' }] }]
		expect(
			renderBrowserPassage(
				{ url: 'about:blank', title: '', lines, from: 1, to: 100, tabs: [], changed: false },
				4000,
			),
		).toContain('[lines 1–1 of 1; the whole page]')
		expect(() =>
			renderBrowserPassage(
				{ url: 'about:blank', title: '', lines, from: 1, tabs: [], changed: false },
				20,
			),
		).toThrow('next complete line')
	})
})
