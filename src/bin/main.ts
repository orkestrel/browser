import { parseBoolean } from '@orkestrel/contract'
import { BrowserError, isBrowserError } from '@src/core'
import { createBrowserMCPServer } from '@src/server'

try {
	const { BROWSE_ROOT, BROWSE_HEADLESS, BROWSE_EXECUTABLE, BROWSE_READONLY } = process.env
	const headless = parseBoolean(BROWSE_HEADLESS)
	const readonly = parseBoolean(BROWSE_READONLY)
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
	await createBrowserMCPServer({
		...(BROWSE_ROOT === undefined || BROWSE_ROOT === '' ? {} : { root: BROWSE_ROOT }),
		...(headless === undefined ? {} : { headless }),
		...(BROWSE_EXECUTABLE === undefined || BROWSE_EXECUTABLE === ''
			? {}
			: { executable: BROWSE_EXECUTABLE }),
		...(readonly === undefined ? {} : { readonly }),
	}).start()
} catch (error) {
	if (!isBrowserError(error)) throw error
	console.error(`browse: ${error.code}: ${error.message.split(/\r\n|\n/u).join(' ')}`)
	process.exitCode = 1
}
