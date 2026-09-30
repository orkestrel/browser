import { describe, expect, it } from 'vitest'
import { isBrowserElementError, isBrowserError } from '@src/core'
import {
	computeBrowserName,
	computeBrowserRole,
	computeBrowserText,
	isBrowserDocument,
	matchesBrowserHidden,
	matchesBrowserPopup,
	observeBrowserMutations,
	readBrowserBlock,
	skipBrowserSubtree,
} from '@src/browser'
import { requireValue } from '@orkestrel/test'
import {
	createProbeDocument,
	createProbeElements,
	PROBE_NAME_CASES,
	PROBE_POPUP_CASES,
	PROBE_ROLE_CASES,
	readBrowserFixtureBase,
	readProbeCase,
} from '../../setupBrowser.js'

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

describe('computeBrowserRole', () => {
	it.each(PROBE_ROLE_CASES)('maps $markup ($css) to $expected', ({ markup, css, expected }) => {
		expect(computeBrowserRole(readProbeCase(markup, css))).toBe(expected)
	})
})

describe('computeBrowserName', () => {
	it.each(PROBE_NAME_CASES)('names $markup ($css) "$expected"', ({ markup, css, expected }) => {
		expect(computeBrowserName(readProbeCase(markup, css))).toBe(expected)
	})

	it('takes content only for the role it is given', () => {
		const element = readProbeCase('<div>Text</div>', 'div')
		expect(computeBrowserName(element, 'button')).toBe('Text')
		expect(computeBrowserName(element, 'region')).toBe('')
	})
})

describe('computeBrowserText', () => {
	it('joins blocks with a space and skips select and textarea content', () => {
		const element = readProbeCase(
			'<a><div>Cars</div><div>Search the <b>fleet</b></div><select><option>Hidden</option></select><textarea>Draft</textarea></a>',
			'a',
		)
		expect(computeBrowserText(element)).toBe('Cars Search the fleet')
	})

	it('falls back to the text content of an element in a document without a window', () => {
		const detached = document.implementation.createHTMLDocument('detached')
		detached.body.innerHTML = '<p> Plain   text </p>'
		expect(computeBrowserText(requireValue(detached.querySelector('p'), 'p'))).toBe('Plain text')
	})

	it('returns the empty string for an element without text', () => {
		expect(computeBrowserText(readProbeCase('<span></span>', 'span'))).toBe('')
	})
})

describe('matchesBrowserHidden', () => {
	it('reports hidden, aria-hidden, and display: none, and admits a rendered element', () => {
		const probe = createProbeDocument(
			'<p hidden>a</p><p aria-hidden="true">b</p><p style="display:none">c</p><p aria-hidden="false">d</p><p>e</p>',
		)
		expect(
			Array.from(probe.querySelectorAll('p'), (paragraph) => matchesBrowserHidden(paragraph)),
		).toEqual([true, true, true, false, false])
	})
})

describe('matchesBrowserPopup', () => {
	it.each(PROBE_POPUP_CASES)('reports $markup ($css) as $expected', ({ markup, css, expected }) => {
		expect(matchesBrowserPopup(readProbeCase(markup, css))).toBe(expected)
	})

	it('treats a target naming the element window as the current context', () => {
		const probe = createProbeDocument('<a href="/cars" target="checkout">Cars</a>')
		const link = requireValue(probe.querySelector('a'), 'a')
		expect(matchesBrowserPopup(link)).toBe(true)
		const view = requireValue(probe.defaultView, 'probe window')
		view.name = 'checkout'
		expect(matchesBrowserPopup(link)).toBe(false)
	})
})

describe('skipBrowserSubtree', () => {
	it('moves past the current subtree to the following node, and returns null at the end', () => {
		const probe = createProbeDocument(
			'<div id="root"><p id="first"><b>x</b></p><span id="next"></span></div>',
		)
		const root = requireValue(probe.getElementById('root'), 'root')
		const walker = probe.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
		expect(walker.nextNode()).toBe(probe.getElementById('first'))
		expect(skipBrowserSubtree(walker)).toBe(probe.getElementById('next'))
		expect(skipBrowserSubtree(walker)).toBeNull()
	})
})

describe('readBrowserBlock', () => {
	it('returns the nearest block ancestor, or the root when every ancestor is inline', () => {
		const probe = createProbeDocument('<p><b><i id="deep">x</i></b></p><span id="inline">y</span>')
		const deep = probe.getElementById('deep')
		expect(readBrowserBlock(deep, probe.body)).toBe(probe.querySelector('p'))
		expect(readBrowserBlock(probe.getElementById('inline'), probe.body)).toBe(probe.body)
		expect(readBrowserBlock(null, probe.body)).toBe(probe.body)
	})
})

describe('observeBrowserMutations', () => {
	it('resolves at once when the check already holds', async () => {
		const probe = createProbeDocument('<p id="ready">ready</p>')
		const found = await observeBrowserMutations({
			documents: [probe],
			check: () => probe.getElementById('ready') ?? undefined,
			timeout: 0,
			subject: 'Ready wait',
		})
		expect(found.textContent).toBe('ready')
	})

	it('re-runs the check after a mutation and resolves its value', async () => {
		const probe = createProbeDocument('<main></main>')
		const pending = observeBrowserMutations({
			documents: [probe],
			check: () => probe.getElementById('late')?.textContent ?? undefined,
			timeout: 1_000,
			subject: 'Late wait',
		})
		setTimeout(() => probe.body.insertAdjacentHTML('beforeend', '<p id="late">late</p>'), 10)
		expect(await pending).toBe('late')
	})

	it('rejects at its deadline, on abort, and with what the check throws', async () => {
		const probe = createProbeDocument('<main></main>')
		const expired = await observeBrowserMutations({
			documents: [probe],
			check: () => undefined,
			timeout: 10,
			subject: 'Never wait',
		}).catch((error: unknown) => error)
		expect(isBrowserError(expired) && expired.message).toBe('Never wait timed out')
		const controller = new AbortController()
		const aborted = observeBrowserMutations({
			documents: [probe],
			check: () => undefined,
			timeout: 1_000,
			signal: controller.signal,
			subject: 'Aborted wait',
		})
		controller.abort(new Error('stopped'))
		await expect(aborted).rejects.toThrow('stopped')
		let calls = 0
		const failing = observeBrowserMutations({
			documents: [probe],
			check: () => {
				calls += 1
				if (calls > 1) throw new Error('check failed')
				return undefined
			},
			timeout: 1_000,
			subject: 'Failing wait',
		})
		probe.body.append(probe.createElement('p'))
		await expect(failing).rejects.toThrow('check failed')
	})

	it('rejects with GONE when an observed window fires pagehide', async () => {
		const probe = await createProbeElements()
		const pending = observeBrowserMutations({
			documents: [probe.document],
			check: () => undefined,
			timeout: 1_000,
			subject: 'Unloaded wait',
		})
		probe.frame.remove()
		const refusal = await pending.catch((error: unknown) => error)
		expect(isBrowserElementError(refusal) && refusal.context).toMatchObject({ reason: 'GONE' })
	})

	it('rejects before parking when the signal is already aborted', async () => {
		const probe = createProbeDocument('<main></main>')
		await expect(
			observeBrowserMutations({
				documents: [probe],
				check: () => true,
				timeout: 1_000,
				signal: AbortSignal.abort(new Error('early')),
				subject: 'Early wait',
			}),
		).rejects.toThrow('early')
	})
})
