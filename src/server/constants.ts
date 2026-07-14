import type { BrowserDiscoveryResult } from './types.js'

// === CDP discovery

/** Default CDP port probed for an existing browser and used for launches. */
export const BROWSER_DEFAULT_CDP_PORT = 9222

/** Default host probed for an existing browser and used for launches (avoids `localhost` resolving to `::1` when Chromium binds `127.0.0.1`). */
export const BROWSER_DEFAULT_HOST = '127.0.0.1'

/** Protocol prefix for CDP discovery requests. */
export const BROWSER_CDP_PROTOCOL = 'http'

/** Path appended to the CDP host to fetch version metadata (endpoint discovery). */
export const BROWSER_CDP_VERSION_PATH = '/json/version'

/** Path appended to the CDP host to list open targets (pages, workers, etc). */
export const BROWSER_CDP_LIST_PATH = '/json/list'

/** Sentinel result returned by discovery when no browser is reachable. */
export const BROWSER_NOT_FOUND_RESULT: BrowserDiscoveryResult = Object.freeze({
	found: false,
	endpoint: undefined,
	browser: undefined,
	connection: undefined,
})

// === Browser launch

/** Flags always passed to a launched browser process, alongside the caller's own. */
export const BROWSER_LAUNCH_ARGS: readonly string[] = Object.freeze([
	'--no-first-run',
	'--no-default-browser-check',
])

/** Flag enabling headless mode on a launched browser process. */
export const BROWSER_HEADLESS_ARG = '--headless=new'

/** Grace period after SIGTERM before a launched process is escalated to SIGKILL during teardown. */
export const BROWSER_KILL_GRACE_MS = 3_000

/** Well-known Chrome/Chromium/Edge executable paths, keyed by `process.platform`. */
export const BROWSER_EXECUTABLE_PATHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	linux: Object.freeze([
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/usr/bin/microsoft-edge',
		'/usr/bin/microsoft-edge-stable',
	]),
	darwin: Object.freeze([
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
		'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
	]),
	win32: Object.freeze([
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
		'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
	]),
})

/** Command names probed on PATH when no well-known executable path exists. */
export const BROWSER_EXECUTABLE_NAMES: readonly string[] = Object.freeze([
	'google-chrome',
	'google-chrome-stable',
	'chromium',
	'chromium-browser',
	'microsoft-edge',
	'microsoft-edge-stable',
])
