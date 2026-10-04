import { parseBoolean, parseInteger } from '@orkestrel/contract'
import { BrowserError, isBrowserError } from '@src/core'
import { createBrowserMCPServer } from '@src/server'

try {
	const { BROWSE_ROOT, BROWSE_HEADLESS, BROWSE_EXECUTABLE, BROWSE_READONLY, BROWSE_POOL } =
		process.env
	const headless = parseBoolean(BROWSE_HEADLESS)
	const readonly = parseBoolean(BROWSE_READONLY)
	const size = parseInteger(BROWSE_POOL)
	// An empty variable counts as unset, as a shell's `NAME=` leaves it.
	for (const [name, value, parsed] of [
		['BROWSE_HEADLESS', BROWSE_HEADLESS, headless],
		['BROWSE_READONLY', BROWSE_READONLY, readonly],
	] as const) {
		if (value !== undefined && value !== '' && parsed === undefined) {
			throw new BrowserError(
				`${name} must be true, false, 1, or 0, not ${JSON.stringify(value)}`,
				'BROWSER_SERVER_ENVIRONMENT',
				{ name, value },
			)
		}
	}
	if (BROWSE_POOL !== undefined && BROWSE_POOL !== '' && size === undefined)
		throw new BrowserError(
			`BROWSE_POOL must be an integer, not ${JSON.stringify(BROWSE_POOL)}`,
			'BROWSER_SERVER_ENVIRONMENT',
			{ name: 'BROWSE_POOL', value: BROWSE_POOL },
		)
	await createBrowserMCPServer({
		...(BROWSE_ROOT === undefined || BROWSE_ROOT === '' ? {} : { root: BROWSE_ROOT }),
		...(headless === undefined ? {} : { headless }),
		...(BROWSE_EXECUTABLE === undefined || BROWSE_EXECUTABLE === ''
			? {}
			: { executable: BROWSE_EXECUTABLE }),
		...(readonly === undefined ? {} : { readonly }),
		...(size === undefined ? {} : { pool: { size } }),
	}).start()
} catch (error) {
	if (!isBrowserError(error)) throw error
	console.error(`browse: ${error.code}: ${error.message.split(/\r\n|\n/u).join(' ')}`)
	process.exitCode = 1
}
