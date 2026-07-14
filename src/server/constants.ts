import type { BrowserDiscoveryResult, BrowserEngine } from './types.js'

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

/** Bound for the `discover: false` port-occupancy probe before launching — short, since it only needs to detect an already-listening CDP endpoint, not perform full discovery. */
export const BROWSER_PORT_PROBE_TIMEOUT_MS = 200

/** Brief defer applied once when a transport loss is observed on an owned process, giving a near-simultaneous process-exit event (which libuv may reap slightly later than the socket close) first say over the diagnosis. */
export const BROWSER_TRANSPORT_LOSS_DEFER_MS = 50

/** Environment variables checked (in order) for an explicit browser executable path override. */
export const BROWSER_ENV_PATH_KEYS: readonly string[] = Object.freeze([
	'PLAYWRIGHT_EXECUTABLE_PATH',
	'CHROME_PATH',
])

/** Well-known Chrome/Chromium/Edge executable paths with no platform-specific root, keyed by `process.platform`. */
export const BROWSER_EXECUTABLE_PATHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
	linux: Object.freeze([
		'/usr/bin/google-chrome',
		'/usr/bin/google-chrome-stable',
		'/usr/bin/microsoft-edge',
		'/usr/bin/microsoft-edge-stable',
		'/usr/bin/chromium',
		'/usr/bin/chromium-browser',
		'/snap/bin/chromium',
		'/opt/google/chrome/chrome',
		'/opt/microsoft/msedge/msedge',
	]),
	darwin: Object.freeze([
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
		'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
		'/Applications/Chromium.app/Contents/MacOS/Chromium',
	]),
	win32: Object.freeze([]),
})

/** Windows install-root-relative suffixes for Chrome/Edge/Chromium, joined against each candidate root (`PROGRAMFILES`, `PROGRAMFILES(X86)`, `LOCALAPPDATA`). */
export const BROWSER_WINDOWS_SUFFIXES: readonly string[] = Object.freeze([
	'Google\\Chrome\\Application\\chrome.exe',
	'Microsoft\\Edge\\Application\\msedge.exe',
	'Chromium\\Application\\chrome.exe',
])

/** Fallback Windows install roots used when the corresponding environment variable is absent. */
export const BROWSER_WINDOWS_ROOT_FALLBACKS: Readonly<Record<string, string>> = Object.freeze({
	PROGRAMFILES: 'C:\\Program Files',
	'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
})

/** Command names probed on PATH when no well-known executable path exists. */
export const BROWSER_EXECUTABLE_NAMES: readonly string[] = Object.freeze([
	'google-chrome',
	'google-chrome-stable',
	'msedge',
	'microsoft-edge',
	'chromium',
	'chromium-browser',
	'chrome',
])

/** Environment variable naming an additional Playwright browser store base directory. */
export const BROWSER_STORE_ENV_KEY = 'PLAYWRIGHT_BROWSERS_PATH'

/** Well-known Playwright browser store base directories checked in addition to `PLAYWRIGHT_BROWSERS_PATH`. */
export const BROWSER_STORE_DEFAULT_DIRS: readonly string[] = Object.freeze(['/opt/pw-browsers'])

/** Per-OS default Playwright browser cache directory, relative to the home directory (win32 uses `LOCALAPPDATA` directly). */
export const BROWSER_STORE_CACHE_DIRS: Readonly<Record<string, string>> = Object.freeze({
	linux: '.cache/ms-playwright',
	darwin: 'Library/Caches/ms-playwright',
})

/** Name of the top-level Chromium symlink/binary Playwright maintains inside a browser store base. */
export const BROWSER_STORE_LINK_NAME = 'chromium'

/**
 * Case-insensitive substrings identifying an executable path/name's browser
 * engine, checked by `parseBrowserEngine` in the order `edge` → `chromium` → `chrome`.
 */
export const BROWSER_ENGINE_HINTS: Readonly<Record<BrowserEngine, readonly string[]>> = Object.freeze({
	edge: Object.freeze(['msedge', 'microsoft-edge', 'edge']),
	chromium: Object.freeze([
		'chromium',
		'pw-browsers',
		'chrome-linux',
		'chrome-win',
		'chrome-mac',
		'chrome_headless',
	]),
	chrome: Object.freeze(['google-chrome', 'google/chrome', 'google\\chrome', 'chrome']),
})

/** Glob pattern (relative to a store base) matching a versioned Chromium binary, keyed by `process.platform`. */
export const BROWSER_STORE_GLOBS: Readonly<Record<string, string>> = Object.freeze({
	linux: 'chromium-*/chrome-linux*/chrome',
	darwin: 'chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium',
	win32: 'chromium-*/chrome-win*/chrome.exe',
})
