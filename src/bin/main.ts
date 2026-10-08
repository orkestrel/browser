import { parseBoolean, parseInteger } from '@orkestrel/contract'
import { BrowserError, isBrowserError } from '@src/core'
import { createBrowserMCPServer, parseBrowserViewport } from '@src/server'

// The entry owns stderr; a closed reader must not interrupt the server's teardown barrier.
process.stderr.on('error', () => {
	process.exitCode = 1
})

try {
	const {
		BROWSE_ROOT,
		BROWSE_HEADLESS,
		BROWSE_EXECUTABLE,
		BROWSE_READONLY,
		BROWSE_POOL,
		BROWSE_CONTEXTS,
		BROWSE_VIEWPORT,
	} = process.env
	const headless = parseBoolean(BROWSE_HEADLESS)
	const readonly = parseBoolean(BROWSE_READONLY)
	const size = parseInteger(BROWSE_POOL)
	const contexts = parseInteger(BROWSE_CONTEXTS)
	const viewport = parseBrowserViewport(BROWSE_VIEWPORT)
	// An empty variable counts as unset, as a shell's `NAME=` leaves it.
	for (const [name, value, parsed] of [
		['BROWSE_HEADLESS', BROWSE_HEADLESS, headless],
		['BROWSE_READONLY', BROWSE_READONLY, readonly],
	] as const) {
		if (value !== undefined && value !== '' && parsed === undefined) {
			throw new BrowserError(
				'SERVER_ENVIRONMENT',
				`${name} must be true, false, 1, or 0, not ${JSON.stringify(value)}`,
				{ name, value },
			)
		}
	}
	if (BROWSE_POOL !== undefined && BROWSE_POOL !== '' && size === undefined)
		throw new BrowserError(
			'SERVER_ENVIRONMENT',
			`BROWSE_POOL must be an integer, not ${JSON.stringify(BROWSE_POOL)}`,
			{ name: 'BROWSE_POOL', value: BROWSE_POOL },
		)
	if (BROWSE_VIEWPORT !== undefined && BROWSE_VIEWPORT !== '' && viewport === undefined)
		throw new BrowserError(
			'SERVER_ENVIRONMENT',
			`BROWSE_VIEWPORT must be positive integers in WIDTHxHEIGHT form, not ${JSON.stringify(BROWSE_VIEWPORT)}`,
			{ name: 'BROWSE_VIEWPORT', value: BROWSE_VIEWPORT },
		)
	if (BROWSE_CONTEXTS !== undefined && BROWSE_CONTEXTS !== '' && contexts === undefined)
		throw new BrowserError(
			'SERVER_ENVIRONMENT',
			`BROWSE_CONTEXTS must be an integer, not ${JSON.stringify(BROWSE_CONTEXTS)}`,
			{ name: 'BROWSE_CONTEXTS', value: BROWSE_CONTEXTS },
		)
	await createBrowserMCPServer({
		...(BROWSE_ROOT === undefined || BROWSE_ROOT === '' ? {} : { root: BROWSE_ROOT }),
		browser: {
			...(headless === undefined ? {} : { headless }),
			...(BROWSE_EXECUTABLE === undefined || BROWSE_EXECUTABLE === ''
				? {}
				: { executable: BROWSE_EXECUTABLE }),
			...(viewport === undefined ? {} : { viewport }),
		},
		journeys: { ...(readonly === undefined ? {} : { readonly }) },
		pool: {
			...(size === undefined ? {} : { size }),
			...(contexts === undefined ? {} : { contexts }),
		},
	}).start()
} catch (error) {
	if (!isBrowserError(error)) throw error
	console.error(`browse: ${error.code}: ${error.message.split(/\r\n|\n/u).join(' ')}`)
	process.exitCode = 1
}
