import { describe, expect, it } from 'vitest'
import {
	collectBrowserRoots,
	computeBrowserAlternative,
	computeBrowserName,
	computeBrowserRole,
	computeBrowserText,
	isBrowserDocument,
	listenBrowserNavigation,
	matchesBrowserActivation,
	matchesBrowserBlock,
	matchesBrowserHidden,
	matchesBrowserInvisible,
	matchesBrowserOmitted,
	matchesBrowserPopup,
	readBrowserCapture,
	readBrowserBlock,
	readBrowserParent,
	readBrowserStates,
	readBrowserToken,
	BROWSER_EXPANDED_ROLES,
	skipBrowserSubtree,
} from '@src/browser'
import { BROWSER_RESULT_LIMIT, createBrowserReading, isBrowserResultLimitError } from '@src/core'
import {
	RENDERED_PAGE,
	RENDERED_TEXT,
	CAPTURE_CASES,
	CAPTURE_ANCESTORS,
	RENDERED_SHADOW_EXPRESSION,
} from '../../setup.js'
import { captureError, createRecorder, requireValue, waitForEvent } from '@orkestrel/test'

import {
	createProbeDocument,
	createProbeElements,
	loadProbeFrame,
	PROBE_NAME_CASES,
	PROBE_POPUP_CASES,
	PROBE_ROLE_CASES,
	PROBE_TOKEN_CASES,
	PROBE_STATE_CASES,
	readBrowserFixtureBase,
	readProbeCase,
	readCompiledCapture,
} from '../../setupBrowser.js'

describe('readBrowserToken and readBrowserStates', () => {
	it.each(PROBE_TOKEN_CASES)(
		'reads pressed token $token without trimming',
		({ token, normalized, pressed }) => {
			const button = document.createElement('button')
			if (token !== undefined) button.setAttribute('aria-pressed', token)
			expect(readBrowserToken(button, 'aria-pressed')).toBe(normalized)
			expect(readBrowserStates(button, 'button')).toEqual(pressed === undefined ? {} : { pressed })
		},
	)
	it.each(PROBE_STATE_CASES)(
		'reads $role states from $markup',
		({ markup, css, role, expected }) => {
			expect(readBrowserStates(readProbeCase(markup, css), role)).toEqual(expected)
		},
	)
	it.each([...BROWSER_EXPANDED_ROLES])(
		'reads explicit false and absent expansion for %s',
		(role) => {
			const element = document.createElement('div')
			expect(readBrowserStates(element, role)).not.toHaveProperty('expanded')
			element.setAttribute('aria-expanded', 'false')
			expect(readBrowserStates(element, role)).toHaveProperty('expanded', false)
			element.setAttribute('aria-expanded', 'mixed')
			expect(readBrowserStates(element, role)).toHaveProperty('expanded', true)
			element.setAttribute('aria-expanded', 'undefined')
			expect(readBrowserStates(element, role)).not.toHaveProperty('expanded')
		},
	)
})

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

	it('names an option by aria-label, then its label attribute, then its collapsed text', () => {
		const probe = createProbeDocument(
			[
				'<select>',
				'<option aria-label="Tiny" label="T">t</option>',
				'<option label="Large">L</option>',
				'<option> Medium  size </option>',
				'</select>',
			].join(''),
		)
		expect(
			Array.from(probe.querySelectorAll('option'), (option) => computeBrowserName(option)),
		).toEqual(['Tiny', 'Large', 'Medium size'])
	})
})

describe('computeBrowserText', () => {
	it('joins blocks with a space and takes embedded controls by value, not option text', () => {
		const element = readProbeCase(
			'<a><div>Cars</div><div>Search the <b>fleet</b></div><select><option>Small</option><option selected>Large</option></select> <textarea>Draft</textarea></a>',
			'a',
		)
		expect(computeBrowserText(element)).toBe('Cars Search the fleet Large Draft')
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
			'<img id="image" alt="Logo"><span id="label" aria-label="Close">x</span><p id="text">Plain</p><script id="code">run()</script>',
		)
		const ids = ['image', 'label', 'text', 'code']
		expect(
			ids.map((id) => computeBrowserAlternative(requireValue(probe.getElementById(id), id))),
		).toEqual(['Logo', 'Close', 'Plain', ''])
		expect(computeBrowserAlternative(probe.createTextNode(' raw '))).toBe(' raw ')
	})

	it('omits hidden content unless hidden content is admitted', () => {
		const element = readProbeCase('<p hidden>Secret <span hidden>name</span></p>', 'p')
		expect(computeBrowserAlternative(element)).toBe('')
		expect(computeBrowserAlternative(element, { hidden: true })).toBe('Secret name')
	})

	it('omits a text node whose parent is invisible', () => {
		const element = readProbeCase('<p><span style="visibility: hidden">Ghost</span>Shown</p>', 'p')
		expect(computeBrowserText(element)).toBe('Shown')
	})
})

describe('computeBrowserAlternative with a target', () => {
	it('gives an embedded control its value unless it is the target', () => {
		const probe = createProbeDocument(
			'<input id="amount" value="5"><select id="size"><option>Small</option><option selected>Large</option></select><textarea id="note">Gift</textarea><input id="secret" type="password" value="hunter2">',
		)
		const amount = requireValue(probe.getElementById('amount'), 'amount')
		const ids = ['amount', 'size', 'note', 'secret']
		expect(
			ids.map((id) => computeBrowserAlternative(requireValue(probe.getElementById(id), id))),
		).toEqual(['5', 'Large', 'Gift', ''])
		expect(computeBrowserAlternative(amount, { target: amount })).toBe('')
	})

	it('falls back to the title of an element with no other alternative', () => {
		expect(computeBrowserAlternative(readProbeCase('<img title="Save">', 'img'))).toBe('Save')
		expect(computeBrowserAlternative(readProbeCase('<span title="Tip"></span>', 'span'))).toBe(
			'Tip',
		)
	})
})

describe('matchesBrowserActivation', () => {
	it('admits the label and a non-interactive descendant, and refuses an interactive one', () => {
		const probe = createProbeDocument(
			'<label>Photo <span id="text">here</span><a id="link" href="#help"><b id="inner">Help</b></a><input id="field"><img id="still" src="still.png"><img id="animation" controls src="animation.gif"><img id="map" usemap="#regions" src="map.png"></label>',
		)
		const label = requireValue(probe.querySelector('label'), 'label')
		const ids = ['text', 'link', 'inner', 'field', 'still', 'animation', 'map']
		expect(
			ids.map((id) => matchesBrowserActivation(requireValue(probe.getElementById(id), id), label)),
		).toEqual([true, false, false, false, true, false, false])
		expect(matchesBrowserActivation(label, label)).toBe(true)
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
				'<button style="display: contents">f</button>',
			].join(''),
		)
		expect(
			Array.from(probe.querySelectorAll('button'), (button) => matchesBrowserInvisible(button)),
		).toEqual([true, true, false, false, false, false])
	})

	it('gives an option and a group of a drop-down select the visibility of that select', () => {
		const probe = createProbeDocument(
			[
				'<select><optgroup label="Sizes"><option>Small</option></optgroup>',
				'<option style="visibility: hidden">Large</option></select>',
				'<select style="visibility: hidden"><option>Medium</option></select>',
			].join(''),
		)
		expect(
			Array.from(probe.querySelectorAll('optgroup, option'), (element) =>
				matchesBrowserInvisible(element),
			),
		).toEqual([false, false, true, true])
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
	it('reads an assigned slot before the parent element', () => {
		const host = readProbeCase(
			'<div><template shadowrootmode="open"><section><slot></slot></section></template><button>Save</button></div>',
			'div',
		)
		const slot = requireValue(host.shadowRoot?.querySelector('slot'), 'slot')
		expect(readBrowserParent(requireValue(host.querySelector('button'), 'button'))).toBe(slot)
	})

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

describe.each(['DOM', 'compiled'])('rendered capture %s', (placement) => {
	const read = placement === 'DOM' ? readBrowserCapture : readCompiledCapture
	it('reads the selected switch branch after offscreen auto content is skipped', async () => {
		const fixture = requireValue(
			CAPTURE_CASES.find((candidate) => candidate.name === 'SVG switch offscreen auto visibility'),
		)
		const document = createProbeDocument(fixture.html)
		const view = requireValue(document.defaultView)
		await new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()))
		await new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()))
		const subtree = requireValue(document.querySelector('div'))
		expect(subtree.getBoundingClientRect().top).toBeGreaterThan(view.innerHeight)
		expect(
			requireValue(document.querySelector('svg')).checkVisibility({ contentVisibilityAuto: true }),
		).toBe(false)
		const branches = Array.from(document.querySelectorAll('switch > *'))
		expect(branches.map((branch) => branch.getClientRects().length)).toEqual([0, 1])
		expect(createBrowserReading(read(document.documentElement)).text().text.trim()).toBe(
			fixture.text,
		)
		expect(read(requireValue(document.querySelector('foreignObject div'))).html).toBe('')
		expect(
			createBrowserReading(read(requireValue(document.querySelector('text'))))
				.text()
				.text.trim(),
		).toBe(fixture.text)
	})
	it('preserves paired siblings while pruning mixed node kinds', () => {
		const document = createProbeDocument(
			'<div style="visibility:hidden">hidden <span style="visibility:visible">First</span>hidden <span style="display:none">Omitted</span>hidden <span style="visibility:visible">Last</span>tail</div>',
		)
		expect(
			createBrowserReading(read(document.documentElement)).text().text.replace(/\s+/g, ' ').trim(),
		).toBe('FirstLast')
	})
	it('visits children of a namespaced select that cannot be lowered', () => {
		const document = createProbeDocument('<p>Public label</p>')
		const select = document.createElementNS('urn:example', 'select')
		select.innerHTML =
			'<span style="display:none">Unvisited child</span><script>activePayload()</script>'
		document.body.append(select)
		expect(read(document.documentElement).html).not.toMatch(/Unvisited child|activePayload/)
	})

	it.each(CAPTURE_ANCESTORS)('omits a direct read under $name', ({ html, edit }) => {
		const document = createProbeDocument(html)
		requireValue(document.defaultView).eval(edit)
		expect(createBrowserReading(read(document.documentElement)).text().text).not.toContain(
			'Omitted text',
		)
		expect(read(requireValue(document.querySelector('#target'))).html).toBe('')
	})
	it('redacts adopted select children and still visits them', () => {
		const source = createProbeDocument('<select></select>')
		const destination = createProbeDocument('<p>Public label</p>')
		const select = requireValue(source.querySelector('select'))
		select.innerHTML = '<option>Chosen label</option>'
		const input = source.createElement('input')
		input.type = 'password'
		input.value = 'private-adopted'
		input.setAttribute('value', 'private-adopted')
		select.append(input)
		destination.body.append(destination.adoptNode(select))
		const capture = read(destination.documentElement)
		expect(capture.html).not.toMatch(/private-adopted|type="password"/)
		expect(capture.html).toContain('Chosen label')
	})
	it('redacts private controls in child frame captures', () => {
		const document = createProbeDocument(
			'<p>Frame prose</p><input type="password" value="private-frame"><input type="hidden" value="hidden-payload">',
		)
		const capture = read(document.documentElement)
		expect(capture.html).not.toMatch(/private-frame|hidden-payload|input/)
		expect(createBrowserReading(capture).text().text.trim()).toBe('Frame prose')
		for (const input of document.querySelectorAll('input')) expect(read(input).html).toBe('')
	})
	it('clips listbox rows outside the horizontal client area', () => {
		const document = createProbeDocument(
			'<select multiple size="3" style="width:120px"><option style="transform:translateX(200px)">Right outside</option><option style="transform:translateX(-200px)">Left outside</option><option>Shown row</option></select>',
		)
		expect(createBrowserReading(read(document.documentElement)).text().text.trim()).toBe(
			'Shown row',
		)
	})
	it('retains visible SVG descendants of an invisible graphic', () => {
		const document = createProbeDocument(
			'<svg style="visibility:hidden"><title>Hidden graphic name</title><text y="20" style="visibility:visible">Visible drawing</text></svg>',
		)
		expect(createBrowserReading(read(document.documentElement)).text().text.trim()).toBe(
			'Visible drawing',
		)
	})
	it('prunes hidden SVG text descendants before lowering printed drawing text', () => {
		const document = createProbeDocument(
			'<svg aria-hidden="true"><text y="20">Printed <tspan style="display:none">Hidden drawing</tspan><tspan style="visibility:hidden">Invisible drawing</tspan><tspan>drawing</tspan></text></svg>',
		)
		expect(createBrowserReading(read(document.documentElement)).text().text.trim()).toBe(
			'Printed drawing',
		)
	})
	it('keeps a group caption when its first option is hidden', () => {
		const document = createProbeDocument(
			'<select size="4"><optgroup label="Shown group"><option style="display:none">Hidden first</option><option>Shown row</option></optgroup></select>',
		)
		expect(
			createBrowserReading(read(document.documentElement)).text().text.replace(/\s+/g, ' ').trim(),
		).toBe('Shown group Shown row')
	})
	it('omits unavailable native multiple-file summaries', () => {
		const document = createProbeDocument('<input type="file" multiple>')
		const view = requireValue(document.defaultView)
		const transfer = new view.DataTransfer()
		transfer.items.add(new view.File(['one'], 'first-unprinted.txt'))
		transfer.items.add(new view.File(['two'], 'second-unprinted.txt'))
		requireValue(document.querySelector('input')).files = transfer.files
		expect(createBrowserReading(read(document.documentElement)).text().text).toBe('')
	})
	it('drops active floor subtrees even when styled or disconnected', () => {
		const document = createProbeDocument('<p>Outside control</p>')
		for (const tag of [
			'script',
			'style',
			'template',
			'frame',
			'frameset',
			'iframe',
			'object',
			'embed',
			'applet',
			'noscript',
			'meta',
			'link',
			'base',
		]) {
			const root = document.createElement(tag)
			root.textContent = 'Nonreading payload'
			root.setAttribute('style', 'display:block')
			expect(read(root).html).toBe('')
		}
	})
	it('scrolls listbox rows and reads direct options through their control', () => {
		const document = createProbeDocument(
			'<select size="3"><option>First row</option><option>Second row</option><option>Third row</option><option>Fourth row</option></select><select id="collapsed"><option selected>Chosen</option><option>Not shown</option></select>',
		)
		const select = requireValue(document.querySelector('select'))
		expect(createBrowserReading(read(select)).text().text.replace(/\s+/g, ' ').trim()).toBe(
			'First row Second row Third row',
		)
		select.scrollTop = select.scrollHeight
		expect(createBrowserReading(read(select)).text().text.replace(/\s+/g, ' ').trim()).toBe(
			'Second row Third row Fourth row',
		)
		expect(createBrowserReading(read(requireValue(select.options[0]))).text().text).toBe('')
		expect(
			createBrowserReading(read(requireValue(select.options[3])))
				.text()
				.text.trim(),
		).toBe('Fourth row')
		expect(
			createBrowserReading(
				read(requireValue(document.querySelector('#collapsed option:last-child'))),
			).text().text,
		).toBe('')
	})
	it('excludes hidden listbox rows and groups', () => {
		const document = createProbeDocument(
			'<select multiple size="5"><optgroup label="Hidden group" style="display:none"><option>Hidden child</option></optgroup><option style="display:none">Hidden row</option><option style="visibility:hidden">Invisible row</option><option>Shown row</option></select>',
		)
		expect(createBrowserReading(read(document.documentElement)).text().text.trim()).toBe(
			'Shown row',
		)
	})
	it('redacts private controls in disconnected and windowless data', () => {
		for (const document of [
			globalThis.document,
			globalThis.document.implementation.createHTMLDocument(''),
			createProbeDocument('<p>Other realm</p>').implementation.createHTMLDocument(''),
		]) {
			const root = document.createElement('div')
			root.innerHTML =
				'<p style="display:none">Data only</p><input type="password" value="private-default"><input type="hidden" value="hidden-payload"><template><input type="password" value="template-secret"></template>'
			const capture = read(root)
			expect(capture.html).toContain('Data only')
			expect(capture.html).not.toMatch(/private-default|hidden-payload|template-secret|input/)
			for (const distill of [true, false]) {
				expect(createBrowserReading(capture).text({ distill }).text).not.toMatch(
					/private-default|hidden-payload/,
				)
				expect(createBrowserReading(capture).markdown({ distill }).text).not.toMatch(
					/private-default|hidden-payload/,
				)
			}
			for (const type of ['password', 'hidden']) {
				const input = document.createElement('input')
				input.type = type
				input.value = 'private-root'
				expect(read(input).html).toBe('')
			}
		}
	})
	it('keeps regions and resolves live links while retaining the distill choice', () => {
		const document = createProbeDocument(
			'<base href="https://example.test/base/"><nav><form>Navigation prose</form></nav><header>Header prose</header><aside>Aside prose</aside><menu>Menu prose</menu><p>Outside main</p><main><a href="next">Resolved link</a><p aria-hidden="true">Painted prose</p></main><footer>Footer prose</footer>',
		)
		const capture = read(document.documentElement)
		const reading = createBrowserReading(capture)
		expect(capture.html).toMatch(/<nav>/)
		expect(capture.html).toContain('href="https://example.test/base/next"')
		expect(reading.markdown({ distill: false }).text).toContain(
			'[Resolved link](https://example.test/base/next)',
		)
		for (const phrase of [
			'Navigation prose',
			'Header prose',
			'Aside prose',
			'Menu prose',
			'Outside main',
			'Footer prose',
		]) {
			expect(reading.text({ distill: false }).text).toContain(phrase)
			expect(reading.markdown({ distill: false }).text).toContain(phrase)
			expect(reading.text().text).not.toContain(phrase)
		}
		expect(reading.text().text).toContain('Painted prose')
	})
	it('reads replacement roots and retains escaped page text without markup injection', () => {
		const document = createProbeDocument(
			'<p>Outside text</p><button>Inside text</button><input><select><option>Chosen text</option></select><svg><title>Graphic text</title></svg>',
		)
		for (const [selector, expected] of [
			['button', 'Inside text'],
			['select', 'Chosen text'],
			['svg', 'Graphic text'],
		]) {
			const result = createBrowserReading(
				read(requireValue(document.querySelector(requireValue(selector)))),
			)
			expect(result.text().text.trim()).toBe(expected)
		}
		const input = requireValue(document.querySelector('input'))
		input.value = '<script>Printed & safe</script>'
		const capture = read(input)
		expect(capture.html).toContain('&lt;script&gt;Printed &amp; safe&lt;/script&gt;')
		expect(createBrowserReading(capture).text().text.trim()).toBe(input.value)
	})
	it('keeps modal background and SVG printed text independently of accessibility', () => {
		const document = createProbeDocument(
			'<p>Painted background</p><dialog>Modal prose</dialog><svg aria-hidden="true"><text y="20">Printed drawing</text><title>Decorative title</title></svg>',
		)
		requireValue(document.querySelector('dialog')).showModal()
		const reading = createBrowserReading(read(document.documentElement))
		expect(reading.text().text.replace(/\s+/g, ' ').trim()).toBe(
			'Painted background Modal prose Printed drawing',
		)
	})
	it('measures lowered and JSON escaped values instead of source defaults', () => {
		const document = createProbeDocument('<input>')
		const input = requireValue(document.querySelector('input'))
		input.value = '"'.repeat(Math.ceil(BROWSER_RESULT_LIMIT / 2))
		expect(input.outerHTML.length).toBeLessThan(100)
		expect(() => read(input)).toThrow(/RESULT_LIMIT/)
	})
	it.each(CAPTURE_CASES)(
		'lowers $name with ordered printed expectations',
		({ html, edit, text }) => {
			const document = createProbeDocument(html)
			requireValue(document.defaultView).eval(edit)
			const capture = read(document.documentElement)
			for (const input of document.querySelectorAll('input[type="password"],input[type="hidden"]'))
				expect(read(input).html).toBe('')
			const reading = createBrowserReading(capture)
			for (const distill of [true, false]) {
				expect(reading.markdown({ distill }).text.replace(/\s+/g, ' ').trim()).toBe(text)
				expect(reading.text({ distill }).text.replace(/\s+/g, ' ').trim()).toBe(text)
			}
			expect(capture.html).not.toMatch(
				/private-|hidden-payload|Payload only|Radio payload|#abcdef|fakepath|Old notes|Old name|Default selection|Source selection|Duplicate graphic|Decorative title|Wrong title|Guessed equation|2026-10-03/,
			)
		},
	)
	it('prunes hidden branches and retains visibility overrides', () => {
		const document = createProbeDocument(RENDERED_PAGE)
		requireValue(document.defaultView).eval(RENDERED_SHADOW_EXPRESSION)
		const capture = read(document.documentElement)
		const reading = createBrowserReading(capture)
		for (const distill of [true, false])
			expect(reading.text({ distill }).text.replace(/\s+/g, ' ').trim()).toBe(RENDERED_TEXT)
	})
	it('rendered capture removes invisible alt text and drops active head elements', () => {
		const document = createProbeDocument(RENDERED_PAGE)
		const capture = read(document.documentElement)
		const markdown = createBrowserReading(capture).markdown().text
		expect(markdown).toContain('Shown image alt')
		expect(markdown).not.toContain('Hidden image alt')
		expect(capture.html).not.toContain('<head')
		expect(capture.title).toBe('Rendered reading')
	})
	it('rendered capture empties roots under hidden ancestors including shadow hosts', () => {
		const document = createProbeDocument(RENDERED_PAGE)
		requireValue(document.defaultView).eval(RENDERED_SHADOW_EXPRESSION)
		expect(document.body.innerText).not.toContain('Notes pane inactive')
		expect(read(requireValue(document.querySelector('#hidden-child'))).html).toBe('')
		expect(
			read(requireValue(document.querySelector('#hidden-host')?.shadowRoot?.querySelector('p')))
				.html,
		).toBe('')
	})
	it('rendered capture copies without constructors or live mutations', () => {
		const document = createProbeDocument('<main><p>Text</p></main>')
		const view = requireValue(document.defaultView)
		let count = 0
		view.customElements.define(
			'reading-card',
			class extends view.HTMLElement {
				constructor() {
					super()
					count += 1
				}
			},
		)
		document.body.append(document.createElement('reading-card'))
		count = 0
		const observer = new view.MutationObserver(() => undefined)
		observer.observe(document, {
			subtree: true,
			childList: true,
			attributes: true,
			characterData: true,
		})
		const raw = document.documentElement.outerHTML
		expect(read(document.documentElement).html).toContain('reading-card')
		expect(count).toBe(0)
		expect(document.documentElement.outerHTML).toBe(raw)
		expect(observer.takeRecords()).toHaveLength(0)
		observer.disconnect()
		document.documentElement.cloneNode(true)
		expect(count).toBe(1)
	})
	it('rendered capture measures pruned markup against the result limit', () => {
		const document = createProbeDocument(
			`<div style="display:none">${'x'.repeat(BROWSER_RESULT_LIMIT)}</div><p>Small rendered page</p>`,
		)
		expect(document.documentElement.outerHTML.length).toBeGreaterThan(BROWSER_RESULT_LIMIT)
		expect(read(document.documentElement).html).toContain('Small rendered page')
	})
	it('rendered capture retains auto contents, textarea values, and disconnected data', () => {
		const document = createProbeDocument(
			'<div style="position:absolute;top:5000px;content-visibility:auto">Auto offscreen</div><textarea>Draft area</textarea>',
		)
		const capture = read(document.documentElement)
		expect(capture.html).toContain('Auto offscreen')
		expect(capture.html).toContain('Draft area')
		const detached = document.createElement('p')
		detached.innerHTML = '<span style="display:none">Detached text</span>'
		expect(read(detached).html).toBe(detached.outerHTML)
	})
})

describe('readBrowserCapture', () => {
	// `{"url":"about:blank","title":"t","html":"<p></p>"}` is 50 characters, so a paragraph of
	// `BROWSER_RESULT_LIMIT - 50` characters fills the serialized capture to the limit.
	const room = BROWSER_RESULT_LIMIT - 50

	it('catches a capture refused at the limit, or one passed one character past it', () => {
		const document = globalThis.document.implementation.createHTMLDocument('t')
		const paragraph = document.createElement('p')
		paragraph.textContent = 'x'.repeat(room)
		expect(readBrowserCapture(paragraph)).toEqual({
			url: 'about:blank',
			title: 't',
			html: `<p>${'x'.repeat(room)}</p>`,
		})
		paragraph.textContent = 'x'.repeat(room + 1)
		const refusal = captureError(() => readBrowserCapture(paragraph))
		expect(isBrowserResultLimitError(refusal) && [refusal.code, refusal.context]).toEqual([
			'BROWSER_RESULT_LIMIT_ERROR',
			{ length: BROWSER_RESULT_LIMIT + 1, limit: BROWSER_RESULT_LIMIT },
		])
	})

	it('catches a capture measured by its characters rather than its serialized escapes', () => {
		const document = globalThis.document.implementation.createHTMLDocument('t')
		const paragraph = document.createElement('p')
		paragraph.textContent = `${'x'.repeat(room - 1)}"`
		expect(paragraph.outerHTML.length).toBe(room + '<p></p>'.length)
		const refusal = captureError(() => readBrowserCapture(paragraph))
		expect(isBrowserResultLimitError(refusal) && refusal.context).toEqual({
			length: BROWSER_RESULT_LIMIT + 1,
			limit: BROWSER_RESULT_LIMIT,
		})
	})
})
