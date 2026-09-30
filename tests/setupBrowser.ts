import { afterEach, inject } from 'vitest'

const frames = new Set<HTMLIFrameElement>()

afterEach(() => {
	for (const frame of frames) frame.remove()
	frames.clear()
})

/**
 * Reads the fixture server origin the global setup provides.
 *
 * @returns The loopback origin, without a trailing slash
 */
export function readBrowserFixtureBase(): string {
	return inject('server')
}

/**
 * Builds a same-origin document inside an iframe the test owns.
 *
 * @param html - The markup written into the document
 * @returns The iframe's document; the iframe is removed after the test
 */
export function createProbeDocument(html: string): Document {
	const frame = document.createElement('iframe')
	document.body.append(frame)
	frames.add(frame)
	const probe = frame.contentDocument
	if (probe === null) throw new Error('probe iframe has no document')
	probe.open()
	probe.write(html)
	probe.close()
	return probe
}
