import {
	createBrowser,
} from '@scsr/server'
import type { BrowserInterface, BrowserContextInterface } from '@scsr/server'


// === Browser Test Helpers

/**
 * Launch a headless Chromium browser for unit tests via CDP.
 *
 * Use in `beforeAll` / `afterAll` pairs.
 *
 * @returns Connected BrowserInterface instance
 */
export async function launchTestBrowser(): Promise<BrowserInterface> {
	const browser = createBrowser({
		headless: true,
		args: ['--no-sandbox'],
		executable: process.env['CHROME_EXECUTABLE_PATH'],
	})
	await browser.connect()
	return browser
}

/**
 * Create a new isolated browser context within an existing test browser.
 *
 * @param browser - BrowserInterface to create the context in
 * @returns The first BrowserContextInterface
 */
export async function createTestContext(
	browser: BrowserInterface,
): Promise<BrowserContextInterface> {
	const ctx = browser.context()
	if (ctx !== undefined) return ctx

	// Create a page to ensure a context exists
	await browser.create()
	const created = browser.context()
	if (created === undefined) {
		throw new Error('Failed to create test browser context')
	}
	return created
}
