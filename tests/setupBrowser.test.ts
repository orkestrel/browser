import { describe, expect, it, inject } from 'vitest'
import { createProbeDocument, readBrowserFixtureBase } from './setupBrowser.js'

describe('readBrowserFixtureBase', () => {
	it('returns the origin the global setup injected', () => {
		expect(readBrowserFixtureBase()).toBe(inject('server'))
	})
})

describe('createProbeDocument', () => {
	let probe: Document | undefined

	it('builds a same-origin document holding the markup', () => {
		probe = createProbeDocument('<p id="mark">probe</p>')
		const frame = document.querySelector('iframe')
		expect(frame?.contentDocument).toBe(probe)
		expect(probe.getElementById('mark')?.textContent).toBe('probe')
		expect(probe.location.origin).toBe(window.location.origin)
	})

	it('removes the iframe after the test', () => {
		expect(probe).toBeDefined()
		expect(document.querySelector('iframe')).toBeNull()
	})
})
