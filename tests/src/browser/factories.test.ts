import { describe, expect, it } from 'vitest'
import { isBrowserError } from '@src/core'
import {
	BrowserDOMView,
	createBrowserDOMView,
	createSocketCDPTransport,
	SocketCDPTransport,
} from '@src/browser'
import { captureError } from '@orkestrel/test'
import { createProbeDocument } from '../../setupBrowser.js'

describe('createBrowserDOMView', () => {
	it('creates an untrusted view over a probe document', async () => {
		const probe = createProbeDocument('<title>Cart</title><button>Pay</button>')
		const view = createBrowserDOMView({ document: probe })
		expect(view).toBeInstanceOf(BrowserDOMView)
		expect(view.trusted).toBe(false)
		expect(await view.title()).toBe('Cart')
		expect((await view.elements.outline()).text).toContain('e1 button "Pay"')
	})

	it('refuses the realm own document unless own is true', () => {
		const refusal = captureError(() => createBrowserDOMView({ document: globalThis.document }))
		expect(isBrowserError(refusal) && refusal.code).toBe('BROWSER_DOCUMENT_OWN')
		const own = createBrowserDOMView({ document: globalThis.document, own: true })
		expect(own.url).toBe(globalThis.document.URL)
		own.destroy()
	})

	it('refuses a document without a window', () => {
		const detached = document.implementation.createHTMLDocument('detached')
		expect(() => createBrowserDOMView({ document: detached })).toThrow(
			/requires a document attached to a window/,
		)
	})
})

describe('createSocketCDPTransport', () => {
	it('creates a socket transport that refuses to send before it starts', async () => {
		const transport = createSocketCDPTransport({ url: 'ws://127.0.0.1:9/devtools/browser/x' })
		expect(transport).toBeInstanceOf(SocketCDPTransport)
		await expect(transport.send('{}')).rejects.toThrow(/not open/)
	})
})
