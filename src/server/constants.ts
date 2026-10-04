import type { BrowserEngine } from './types.js'

// === CDP discovery

/**
 * Sets the default CDP port probed for an existing browser and used for launches, `9222`.
 */
export const BROWSER_DEFAULT_CDP_PORT = 9222

/**
 * Sets the default host probed for an existing browser and used for launches, `'127.0.0.1'`,
 * which avoids `localhost` resolving to `::1` when Chromium binds `127.0.0.1`.
 */
export const BROWSER_DEFAULT_HOST = '127.0.0.1'

/** Names the protocol prefix for CDP discovery requests, `'http'`. */
export const BROWSER_CDP_PROTOCOL = 'http'

/**
 * Names the path appended to the CDP host to fetch version metadata, `'/json/version'`, which
 * is where endpoint discovery reads.
 */
export const BROWSER_CDP_VERSION_PATH = '/json/version'

/**
 * Names the path appended to the CDP host to list open targets — pages, workers, and every
 * other target category Chromium reports — `'/json/list'`.
 */
export const BROWSER_CDP_LIST_PATH = '/json/list'

// === Browser launch

/** Lists the flags always passed to a launched browser process, alongside the caller's own. */
export const BROWSER_LAUNCH_ARGS: readonly string[] = Object.freeze([
	'--no-first-run',
	'--no-default-browser-check',
])

/**
 * Names the flag that enables headless mode on a launched browser process, `'--headless=new'`.
 */
export const BROWSER_HEADLESS_ARG = '--headless=new'

/**
 * Names the prefix for isolated browser profiles created beneath the operating-system temp
 * directory, `'orkestrel-browser-'`.
 */
export const BROWSER_PROFILE_PREFIX = 'orkestrel-browser-'

/**
 * Bounds each launched-process exit window during TERM-to-KILL teardown at `3_000`
 * milliseconds.
 */
export const BROWSER_KILL_GRACE_MS = 3_000

/**
 * Bounds the `discover: false` port-occupancy probe before launching at `200` milliseconds,
 * which is short because the probe only needs to detect an already-listening CDP endpoint
 * rather than perform full discovery.
 */
export const BROWSER_PORT_PROBE_TIMEOUT_MS = 200

/**
 * Matches the stderr line Chromium prints when its CDP endpoint accepts connections, and
 * captures the `ws://` endpoint the line names.
 *
 * @remarks
 * Chromium prints the line only when launched with `--remote-debugging-port`, which is why an
 * owned launch always passes that flag.
 */
export const BROWSER_DEVTOOLS_PATTERN = /DevTools listening on (ws:\/\/\S+)/

/**
 * Sets the interval in milliseconds between liveness probes of a terminated browser process
 * group.
 *
 * @remarks
 * Node raises an exit event for the direct child only. Neither the rest of a POSIX process
 * group nor a process a launcher handed the endpoint to raises one, so the bounded drain in
 * `Browser` probes on this interval until the group is gone or the grace period ends.
 */
export const BROWSER_DRAIN_INTERVAL_MS = 100

/**
 * Defers once for `50` milliseconds when a transport loss is observed on an owned process,
 * so a near-simultaneous process-exit event, which libuv might reap slightly later than the
 * socket close, decides the diagnosis first.
 */
export const BROWSER_TRANSPORT_LOSS_DEFER_MS = 50

/**
 * Names the machine-readable error-context cause for an owned browser process exiting,
 * `'process-exit'`.
 */
export const BROWSER_PROCESS_EXIT_CAUSE = 'process-exit'

/**
 * Names the machine-readable error-context cause for a CDP transport disconnecting while its
 * browser remains alive, `'transport-loss'`.
 */
export const BROWSER_TRANSPORT_LOSS_CAUSE = 'transport-loss'

/**
 * Lists the environment variables checked, in order, for an explicit browser executable path
 * override: `PLAYWRIGHT_EXECUTABLE_PATH`, then `CHROME_PATH`.
 */
export const BROWSER_ENV_PATH_KEYS: readonly string[] = Object.freeze([
	'PLAYWRIGHT_EXECUTABLE_PATH',
	'CHROME_PATH',
])

/**
 * Lists the well-known Chrome/Chromium/Edge executable paths with no platform-specific root,
 * keyed by `process.platform`, leaving `win32` empty because its roots come from
 * `BROWSER_WINDOWS_SUFFIXES`.
 */
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

/** Lists the Windows install-root-relative suffixes for Chrome/Edge/Chromium, joined against each candidate root (`PROGRAMFILES`, `PROGRAMFILES(X86)`, `LOCALAPPDATA`). */
export const BROWSER_WINDOWS_SUFFIXES: readonly string[] = Object.freeze([
	'Google\\Chrome\\Application\\chrome.exe',
	'Microsoft\\Edge\\Application\\msedge.exe',
	'Chromium\\Application\\chrome.exe',
])

/**
 * Lists the fallback Windows install roots used when `PROGRAMFILES`, `PROGRAMFILES(X86)`, or
 * `LOCALAPPDATA` is absent.
 */
export const BROWSER_WINDOWS_ROOT_FALLBACKS: Readonly<Record<string, string>> = Object.freeze({
	PROGRAMFILES: 'C:\\Program Files',
	'PROGRAMFILES(X86)': 'C:\\Program Files (x86)',
})

/** Lists the command names probed on PATH when no well-known executable path exists. */
export const BROWSER_EXECUTABLE_NAMES: readonly string[] = Object.freeze([
	'google-chrome',
	'google-chrome-stable',
	'msedge',
	'microsoft-edge',
	'chromium',
	'chromium-browser',
	'chrome',
])

/**
 * Names the environment variable that carries an additional Playwright browser store base
 * directory, `'PLAYWRIGHT_BROWSERS_PATH'`.
 */
export const BROWSER_STORE_ENV_KEY = 'PLAYWRIGHT_BROWSERS_PATH'

/**
 * Lists the well-known Playwright browser store base directories checked in addition to
 * `PLAYWRIGHT_BROWSERS_PATH`, starting with `/opt/pw-browsers`.
 */
export const BROWSER_STORE_DEFAULT_DIRS: readonly string[] = Object.freeze(['/opt/pw-browsers'])

/** Names the per-OS default Playwright browser cache directory, relative to the home directory (win32 uses `LOCALAPPDATA` directly). */
export const BROWSER_STORE_CACHE_DIRS: Readonly<Record<string, string>> = Object.freeze({
	linux: '.cache/ms-playwright',
	darwin: 'Library/Caches/ms-playwright',
})

/**
 * Names the top-level Chromium symlink or binary Playwright maintains inside a browser store
 * base, `'chromium'`.
 */
export const BROWSER_STORE_LINK_NAME = 'chromium'

/**
 * Lists the case-insensitive substrings identifying an executable path/name's browser
 * engine, checked by `parseBrowserEngine` in the order `edge` → `chromium` → `chrome`.
 */
export const BROWSER_ENGINE_HINTS: Readonly<Record<BrowserEngine, readonly string[]>> =
	Object.freeze({
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

/** Names the glob pattern (relative to a store base) matching a versioned Chromium binary, keyed by `process.platform`. */
export const BROWSER_STORE_GLOBS: Readonly<Record<string, string>> = Object.freeze({
	linux: 'chromium-*/chrome-linux*/chrome',
	darwin: 'chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium',
	win32: 'chromium-*/chrome-win*/chrome.exe',
})

/** Names the persisted journey snapshot. */
export const BROWSER_JOURNEY_SNAPSHOT_FILE = 'journey.json'
/** Names the retained journey revision counter. */
export const BROWSER_JOURNEY_REVISION_FILE = 'revision'
/** Names the exclusive journey write lock directory. */
export const BROWSER_JOURNEY_LOCK_DIRECTORY = 'journey.lock'
/** Bounds attempts to acquire a journey lock after concurrent recovery. */
export const BROWSER_JOURNEY_LOCK_ATTEMPTS = 8
/** Names the persisted run snapshot. */
export const BROWSER_RUN_FILE = 'run.json'
/** Names the journey directory holding its runs. */
export const BROWSER_RUN_DIRECTORY = 'runs'
/** Bounds a file-store listing page by default. */
export const BROWSER_FILE_STORE_LIMIT = 100

/** Names the refusal when no browser can serve a call. */
export const BROWSER_SERVER_UNAVAILABLE = 'BROWSER_SERVER_UNAVAILABLE'
/** Names a failed attempt to warm a browser. */
export const BROWSER_SERVER_LAUNCH = 'BROWSER_SERVER_LAUNCH'
/** Sets the default number of warm browsers to 1. */
export const BROWSER_SERVER_POOL_SIZE = 1
/** Limits the number of warm browsers to 3. */
export const BROWSER_SERVER_POOL_LIMIT = 3
/** Permits one failed refill before the next failure spends the bound. */
export const BROWSER_SERVER_RESTARTS = 1
/** Names the browser process record in each profile. */
export const BROWSER_SERVER_RECORD = 'browse.json'
/** Names the diagnostic when the warm floor spends its restart bound. */
export const BROWSER_SERVER_EXHAUSTED = 'BROWSER_SERVER_EXHAUSTED'
/** Names a failed browser server teardown. */
export const BROWSER_SERVER_TEARDOWN = 'BROWSER_SERVER_TEARDOWN'
/** Names a failed profile sweep. */
export const BROWSER_SERVER_SWEEP = 'BROWSER_SERVER_SWEEP'
/** Names a refused browser server option. */
export const BROWSER_SERVER_OPTIONS = 'BROWSER_SERVER_OPTIONS'
/** Names the notice that a browser and its session state were lost. */
export const BROWSER_SERVER_CRASH = 'BROWSER_SERVER_CRASH'
/** Names an interrupted call whose outcome is unknown. */
export const BROWSER_SERVER_UNRESOLVED = 'BROWSER_SERVER_UNRESOLVED'
