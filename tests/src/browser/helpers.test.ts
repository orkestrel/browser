import { describe, expect, it } from 'vitest'
import {
	collectBrowserRoots,
	computeBrowserAlternative,
	computeBrowserName,
	computeBrowserRole,
	computeBrowserText,
	isBrowserDocument,
	listenBrowserNavigation,
	matchesBrowserBlock,
	matchesBrowserHidden,
	matchesBrowserInvisible,
	matchesBrowserOmitted,
	matchesBrowserPopup,
	readBrowserBlock,
	readBrowserParent,
	skipBrowserSubtree,
} from '@src/browser'
import { createRecorder, requireValue, waitForEvent } from '@orkestrel/test'
import {
	createProbeDocument,
	createProbeElements,
	loadProbeFrame,
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

describe('computeBrowserAlternative', () => {
	it('takes an element own alternative before its content, and text node data', () => {
		const probe = createProbeDocument(
			'<img id="image" alt="Logo"><span id="label" aria-label="Close">x</span><p id="text">Plain</p><select id="choice"><option>Small</option></select>',
		)
		const ids = ['image', 'label', 'text', 'choice']
		expect(
			ids.map((id) => computeBrowserAlternative(requireValue(probe.getElementById(id), id))),
		).toEqual(['Logo', 'Close', 'Plain', ''])
		expect(computeBrowserAlternative(probe.createTextNode(' raw '))).toBe(' raw ')
	})

	it('omits hidden content unless hidden content is admitted', () => {
		const element = readProbeCase('<p hidden>Secret <span hidden>name</span></p>', 'p')
		expect(computeBrowserAlternative(element)).toBe('')
		expect(computeBrowserAlternative(element, true)).toBe('Secret name')
	})

	it('omits a text node whose parent is invisible', () => {
		const element = readProbeCase('<p><span style="visibility: hidden">Ghost</span>Shown</p>', 'p')
		expect(computeBrowserText(element)).toBe('Shown')
	})
})

describe('matchesBrowserInvisible', () => {
	it('reports visibility: hidden and a missing box, and admits zero-size and off-screen elements', () => {
		const probe = createProbeDocument(
			[
				'<button style="visibility: hidden">a</button>',
				'<button style="display: none">b</button>',
				'<button style="width: 0; height: 0; padding: 0; border: 0">c</button>',
				'<button style="position: absolute; left: -9999px">d</button>',
				'<button>e</button>',
			].join(''),
		)
		expect(
			Array.from(probe.querySelectorAll('button'), (button) => matchesBrowserInvisible(button)),
		).toEqual([true, true, false, false, false])
	})

	it('reports nothing invisible in a document without a window', () => {
		const detached = document.implementation.createHTMLDocument('detached')
		expect(matchesBrowserInvisible(detached.body)).toBe(false)
	})
})

describe('matchesBrowserOmitted', () => {
	it('reports an element under a hidden ancestor, across a shadow host and a frame element', async () => {
		const probe = createProbeDocument(
			'<section aria-hidden="true"><button id="inside">a</button></section><div id="host"></div><button id="free">b</button>',
		)
		expect(matchesBrowserOmitted(requireValue(probe.getElementById('inside'), 'inside'))).toBe(true)
		expect(matchesBrowserOmitted(requireValue(probe.getElementById('free'), 'free'))).toBe(false)
		const host = requireValue(probe.getElementById('host'), 'host')
		const shadow = host.attachShadow({ mode: 'open' })
		shadow.innerHTML = '<button>Shadowed</button>'
		const shadowed = requireValue(shadow.querySelector('button'), 'shadowed')
		expect(matchesBrowserOmitted(shadowed)).toBe(false)
		host.hidden = true
		expect(matchesBrowserOmitted(shadowed)).toBe(true)
		const framed = await createProbeElements()
		expect(matchesBrowserOmitted(framed.save)).toBe(false)
		framed.frame.setAttribute('aria-hidden', 'true')
		expect(matchesBrowserOmitted(framed.save)).toBe(true)
	})
})

describe('readBrowserParent', () => {
	it('reads the parent element, a shadow host, a frame element, and null without a window', async () => {
		const probe = await createProbeElements()
		const host = probe.document.createElement('div')
		probe.late.append(host)
		const shadow = host.attachShadow({ mode: 'open' })
		shadow.innerHTML = '<span>x</span>'
		expect(readBrowserParent(requireValue(shadow.querySelector('span'), 'span'))).toBe(host)
		expect(readBrowserParent(probe.save)).toBe(probe.save.parentElement)
		expect(readBrowserParent(probe.document.documentElement)).toBe(probe.frame)
		const detached = document.implementation.createHTMLDocument('detached')
		expect(readBrowserParent(detached.documentElement)).toBeNull()
	})
})

describe('matchesBrowserBlock', () => {
	it('reports block boxes and br, and admits inline boxes, display: contents, and no box', () => {
		const probe = createProbeDocument(
			'<p>a</p><br><span>b</span><div style="display: inline-block">c</div><div style="display: contents">d</div><div hidden>e</div>',
		)
		expect(Array.from(probe.body.children, (element) => matchesBrowserBlock(element))).toEqual([
			true,
			true,
			false,
			false,
			false,
			false,
		])
	})
})

describe('collectBrowserRoots', () => {
	it('collects the root, open shadow roots, and same-origin frame documents, and no cross-origin one', async () => {
		const probe = await createProbeElements()
		const host = probe.document.createElement('div')
		probe.late.append(host)
		const shadow = host.attachShadow({ mode: 'open' })
		const inner = await loadProbeFrame(probe.document, shadow, '<p>inner</p>')
		const outer = probe.document.createElement('iframe')
		const loaded = waitForEvent<[Event]>((listener) => {
			outer.addEventListener('load', listener, { once: true })
			return () => outer.removeEventListener('load', listener)
		}, 'cross-origin load')
		outer.src = `${readBrowserFixtureBase()}/`
		probe.late.append(outer)
		await loaded
		for (const roots of [collectBrowserRoots(probe.document), collectBrowserRoots(host)]) {
			expect(roots).toHaveLength(3)
			expect(roots[0]).toBe(probe.document)
			expect(roots[1]).toBe(shadow)
			expect(roots[2]).toBe(inner)
		}
	})
})

describe('listenBrowserNavigation', () => {
	it('delivers navigatesuccess and pagehide until the signal aborts', async () => {
		const probe = await createProbeElements()
		const view = requireValue(probe.document.defaultView, 'probe window')
		const events = createRecorder<[string]>()
		const release = new AbortController()
		listenBrowserNavigation(view, (event) => events.handler(event.type), release.signal)
		const navigated = waitForEvent<[Event]>((listener) => {
			view.navigation.addEventListener('navigatesuccess', listener, { once: true })
			return () => view.navigation.removeEventListener('navigatesuccess', listener)
		}, 'navigatesuccess')
		view.history.pushState(null, '', 'about:srcdoc#first')
		await navigated
		expect(events.calls).toEqual([['navigatesuccess']])
		release.abort()
		const again = waitForEvent<[Event]>((listener) => {
			view.navigation.addEventListener('navigatesuccess', listener, { once: true })
			return () => view.navigation.removeEventListener('navigatesuccess', listener)
		}, 'second navigatesuccess')
		view.history.pushState(null, '', 'about:srcdoc#second')
		await again
		expect(events.calls).toEqual([['navigatesuccess']])
	})

	it('delivers pagehide when the document unloads', async () => {
		const probe = await createProbeElements()
		const view = requireValue(probe.document.defaultView, 'probe window')
		const events = createRecorder<[string]>()
		listenBrowserNavigation(
			view,
			(event) => events.handler(event.type),
			new AbortController().signal,
		)
		probe.frame.remove()
		expect(events.calls).toEqual([['pagehide']])
	})
})
