import type { ChildProcess } from 'node:child_process'
import type { CDPTarget } from '@src/core'
import type { Result } from '@orkestrel/contract'
import type {
	BrowserEngine,
	BrowserProfileResult,
	SystemBrowser,
	SystemBrowserOptions,
} from './types.js'
import { existsSync, globSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, win32 as pathWin32, posix as pathPosix } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { setTimeout as waitForTimeout } from 'node:timers/promises'
import { isArray, isRecord, isString } from '@orkestrel/contract'
import { BROWSER_WAIT_POLL_INTERVAL_MS, BrowserError } from '@src/core'
import { BrowserConnectionError } from './errors.js'
import {
	BROWSER_CDP_PROTOCOL,
	BROWSER_CDP_VERSION_PATH,
	BROWSER_CDP_LIST_PATH,
	BROWSER_ENV_PATH_KEYS,
	BROWSER_EXECUTABLE_PATHS,
	BROWSER_EXECUTABLE_NAMES,
	BROWSER_WINDOWS_SUFFIXES,
	BROWSER_WINDOWS_ROOT_FALLBACKS,
	BROWSER_STORE_ENV_KEY,
	BROWSER_STORE_DEFAULT_DIRS,
	BROWSER_STORE_CACHE_DIRS,
	BROWSER_STORE_LINK_NAME,
	BROWSER_STORE_GLOBS,
	BROWSER_ENGINE_HINTS,
	BROWSER_LAUNCH_ARGS,
	BROWSER_HEADLESS_ARG,
	BROWSER_DEFAULT_HOST,
	BROWSER_PROFILE_PREFIX,
} from './constants.js'

// === Discovery helpers

/**
 * Enumerates every Chrome/Chromium/Edge executable discoverable on this
 * machine, deduplicated by normalized absolute path.
 *
 * @remarks
 * Resolution precedence (candidates appended in this order):
 * 1. `PLAYWRIGHT_EXECUTABLE_PATH`, then `CHROME_PATH` — explicit environment
 *    overrides that exist on disk
 * 2. Well-known platform install locations (Chrome, Edge, Chromium); Windows
 *    roots are derived from `PROGRAMFILES` / `PROGRAMFILES(X86)` / `LOCALAPPDATA`
 * 3. PATH probe for known command names (`which` on POSIX, `where` on Windows)
 * 4. Playwright-managed browser stores (`PLAYWRIGHT_BROWSERS_PATH`, `/opt/pw-browsers`,
 *    and the per-OS Playwright cache directory) — the top-level `chromium`
 *    link/binary, then the highest-revision `chromium-*` install found
 *
 * Each candidate is classified into a {@link BrowserEngine} via
 * `parseBrowserEngine` (unclassifiable candidates default to `'chromium'`),
 * and `options.engine` (when given) narrows the result to that engine.
 *
 * @param options - Overrides for the candidate sources; see {@link SystemBrowserOptions}
 * @returns Every discovered browser, in resolution-precedence order
 */
export function findSystemBrowsers(options?: SystemBrowserOptions): readonly SystemBrowser[] {
	const platform = process.platform
	const env = options?.env ?? process.env

	const candidates: string[] = []

	candidates.push(...findEnvOverrides(env))

	const paths = options?.paths ?? defaultInstallPaths(platform, env)
	candidates.push(...findInstallPaths(paths))

	const names = options?.names ?? BROWSER_EXECUTABLE_NAMES
	candidates.push(...probePathNames(names, platform))

	const stores = options?.stores ?? defaultStoreBases(env, platform)
	for (const store of stores) {
		candidates.push(...findInStore(store, platform))
	}

	const seen = new Set<string>()
	const browsers: SystemBrowser[] = []

	for (const executable of candidates) {
		const key = normalizeExecutablePath(executable, platform)
		if (seen.has(key)) continue
		seen.add(key)

		const engine = parseBrowserEngine(executable) ?? 'chromium'
		if (options?.engine !== undefined && engine !== options.engine) continue

		browsers.push({ executable, engine })
	}

	return browsers
}

/**
 * Locates a Chrome/Chromium/Edge executable on this machine — the first entry
 * of {@link findSystemBrowsers}.
 *
 * @param options - Overrides for the candidate sources; see {@link SystemBrowserOptions}
 * @returns The first discovered browser, or undefined
 */
export function findSystemBrowser(options?: SystemBrowserOptions): SystemBrowser | undefined {
	return findSystemBrowsers(options)[0]
}

/**
 * Classifies an executable path/name into a {@link BrowserEngine} by
 * case-insensitive hint, checked in the order edge → chromium → chrome.
 *
 * @param executable - Executable path or command name to classify
 * @returns The classified engine, or undefined when no hint matches
 */
export function parseBrowserEngine(executable: string): BrowserEngine | undefined {
	const lower = executable.toLowerCase()
	const order: readonly BrowserEngine[] = ['edge', 'chromium', 'chrome']
	for (const engine of order) {
		const hints = BROWSER_ENGINE_HINTS[engine]
		if (hints.some((hint) => lower.includes(hint))) return engine
	}
	return undefined
}

/** Normalizes an executable path for cross-source deduplication (case-insensitive on Windows). */
export function normalizeExecutablePath(path: string, platform: string): string {
	const normalized = platform === 'win32' ? pathWin32.normalize(path) : pathPosix.normalize(path)
	return platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Classifies a `/json/version` `Browser` string into a {@link BrowserEngine} (`Edg/` → edge, `Chrome/` → chrome, else chromium). */
export function browserToEngine(browser?: string): BrowserEngine {
	if (browser?.includes('Edg/') === true) return 'edge'
	if (browser?.includes('Chrome/') === true) return 'chrome'
	return 'chromium'
}

/**
 * Resolves a persistent caller profile or creates an isolated temporary one.
 *
 * @param path - Optional caller-owned persistent user-data directory
 * @returns The resolved profile and whether the library owns its lifecycle
 */
export async function createBrowserProfile(path?: string): Promise<BrowserProfileResult> {
	if (path !== undefined) return { path, temporary: false }
	const directory = await mkdtemp(join(tmpdir(), BROWSER_PROFILE_PREFIX))
	return { path: directory, temporary: true }
}

/**
 * Removes a library-owned isolated browser profile.
 *
 * @remarks
 * The path must remain a direct child of the operating-system temp directory
 * with {@link BROWSER_PROFILE_PREFIX}; this defensive check prevents a
 * malformed profile value from widening recursive deletion.
 *
 * @param profile - Resolved profile lifecycle result
 */
export async function removeBrowserProfile(profile: BrowserProfileResult): Promise<void> {
	if (!profile.temporary) return
	const path = resolve(profile.path)
	const temporary = resolve(tmpdir())
	if (dirname(path) !== temporary || !basename(path).startsWith(BROWSER_PROFILE_PREFIX)) {
		throw new BrowserError('Refusing to remove an unsafe browser profile path', undefined, {
			path,
		})
	}
	await rm(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

/** Checks the env-override keys (`PLAYWRIGHT_EXECUTABLE_PATH`, `CHROME_PATH`) in order and returns every one that exists. */
export function findEnvOverrides(
	env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
	const found: string[] = []
	for (const key of BROWSER_ENV_PATH_KEYS) {
		const value = env[key]
		if (value !== undefined && value.length > 0 && existsSync(value)) found.push(value)
	}
	return found
}

/** Builds the default well-known install-path candidates for a platform, deriving Windows roots from env vars. */
export function defaultInstallPaths(
	platform: string,
	env: Readonly<Record<string, string | undefined>>,
): readonly string[] {
	if (platform !== 'win32') return BROWSER_EXECUTABLE_PATHS[platform] ?? []

	const roots = windowsRoots(env)
	const paths: string[] = []
	for (const root of roots) {
		for (const suffix of BROWSER_WINDOWS_SUFFIXES) {
			paths.push(pathWin32.join(root, suffix))
		}
	}
	return paths
}

/** Derives Windows install roots from env vars, falling back to well-known literals when absent. */
export function windowsRoots(env: Readonly<Record<string, string | undefined>>): readonly string[] {
	const programFiles = env['PROGRAMFILES'] ?? BROWSER_WINDOWS_ROOT_FALLBACKS['PROGRAMFILES']
	const programFilesX86 =
		env['PROGRAMFILES(X86)'] ?? BROWSER_WINDOWS_ROOT_FALLBACKS['PROGRAMFILES(X86)']
	const localAppData = env['LOCALAPPDATA']

	const roots = [programFiles, programFilesX86, localAppData]
	return roots.filter((root): root is string => root !== undefined)
}

/** Returns every candidate path that exists on disk, in the given order. */
export function findInstallPaths(paths: readonly string[]): readonly string[] {
	return paths.filter((path) => existsSync(path))
}

/** Probes PATH (`which`/`where`) for every resolvable command name, in the given order. */
export function probePathNames(names: readonly string[], platform: string): readonly string[] {
	const finder = platform === 'win32' ? 'where' : 'which'
	const found: string[] = []
	for (const name of names) {
		const result = spawnSync(finder, [name], { stdio: 'pipe' })
		if (result.status === 0) {
			const executable = readFirstLine(result.stdout.toString('utf-8'))
			if (executable !== undefined) found.push(executable)
		}
	}
	return found
}

/**
 * Returns the first non-empty line of a command's output, without its
 * surrounding whitespace.
 *
 * @remarks
 * `where` reports every PATH match on its own CRLF-terminated line, so a
 * carriage return left on the first line would travel into `existsSync` and
 * `spawn` as part of the executable path.
 *
 * @param output - Raw decoded standard output of a command
 * @returns The first line carrying text, or undefined when the output has none
 *
 * @example
 * ```ts
 * readFirstLine('C:\\bin\\chrome.exe\r\nC:\\other\\chrome.exe\r\n') // 'C:\\bin\\chrome.exe'
 * ```
 */
export function readFirstLine(output: string): string | undefined {
	for (const line of output.split(/\r?\n/)) {
		const text = line.trim()
		if (text.length > 0) return text
	}
	return undefined
}

/** Builds the default Playwright browser store base directories to search for a managed Chromium. */
export function defaultStoreBases(
	env: Readonly<Record<string, string | undefined>>,
	platform: string,
): readonly string[] {
	const bases: string[] = []

	const envBase = env[BROWSER_STORE_ENV_KEY]
	if (envBase !== undefined && envBase.length > 0) bases.push(envBase)

	bases.push(...BROWSER_STORE_DEFAULT_DIRS)

	if (platform === 'win32') {
		const localAppData = env['LOCALAPPDATA']
		if (localAppData !== undefined) bases.push(pathWin32.join(localAppData, 'ms-playwright'))
	} else {
		const cacheDir = BROWSER_STORE_CACHE_DIRS[platform]
		const home = env['HOME']
		if (cacheDir !== undefined && home !== undefined) bases.push(pathPosix.join(home, cacheDir))
	}

	return bases
}

/** Searches one store base for the top-level `chromium` link and every `chromium-*` install, highest revision first. */
export function findInStore(base: string, platform: string): readonly string[] {
	const joiner = platform === 'win32' ? pathWin32.join : pathPosix.join
	const found: string[] = []

	const linkPath = joiner(base, BROWSER_STORE_LINK_NAME)
	if (existsSync(linkPath)) found.push(linkPath)

	const glob = BROWSER_STORE_GLOBS[platform]
	if (glob === undefined) return found

	const pattern = `${base.replaceAll('\\', '/')}/${glob}`
	const matches = globSync(pattern).filter((match) => existsSync(match))
	matches.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
	found.push(...matches)

	return found
}

/**
 * Launches a browser process with raw-CDP debugging flags.
 *
 * @remarks
 * POSIX launches own an isolated process group so lifecycle teardown can
 * signal and await every Chromium subprocess without affecting the caller.
 * Windows launches are not detached and own no group, so teardown there
 * signals one process by identifier: the spawned process, or the process the
 * launcher handed the endpoint to when that spawned process re-executed the
 * browser and exited. Terminating a Chromium browser process takes its own
 * subprocesses with it, so that single signal drains the tree.
 *
 * @param executable - Absolute path to the browser executable
 * @param port - Port the browser exposes its CDP endpoint on
 * @param headless - Whether to launch in headless mode
 * @param profile - Optional user-data-dir for a persistent profile
 * @param extra - Additional command-line flags
 * @returns The spawned ChildProcess
 */
export function launchBrowserProcess(
	executable: string,
	port: number,
	headless: boolean,
	profile?: string,
	extra?: readonly string[],
): ChildProcess {
	// Caller-supplied args come FIRST so a script path (e.g. `node <script>`,
	// used to spawn a Node stand-in executable cross-platform in tests) lands
	// as an early positional argv entry ahead of the CDP flags below —
	// Chromium itself accepts flags in any order, so production is unaffected.
	const args: string[] = []
	if (extra !== undefined) args.push(...extra)
	args.push(`--remote-debugging-port=${port}`, ...BROWSER_LAUNCH_ARGS)

	if (headless) args.push(BROWSER_HEADLESS_ARG)
	if (profile !== undefined) args.push(`--user-data-dir=${profile}`)

	return spawn(executable, args, {
		stdio: 'ignore',
		detached: process.platform !== 'win32',
	})
}

/**
 * Polls a browser's CDP version endpoint until it responds or the timeout elapses.
 *
 * @param port - Port the browser exposes its CDP endpoint on
 * @param timeout - Maximum time to wait in milliseconds
 * @param host - Host the browser exposes its CDP endpoint on (default `127.0.0.1`)
 * @param signal - Optional external abort; an abort while waiting rethrows rather than resolving
 * @returns The browser's WebSocket debugger URL
 *
 * @throws When the endpoint does not become ready before the timeout
 */
export async function waitForCDPReady(
	port: number,
	timeout: number,
	host: string = BROWSER_DEFAULT_HOST,
	signal?: AbortSignal,
): Promise<string> {
	const url = `${BROWSER_CDP_PROTOCOL}://${host}:${port}${BROWSER_CDP_VERSION_PATH}`
	const deadline = Date.now() + timeout

	while (Date.now() < deadline) {
		signal?.throwIfAborted()
		const remaining = Math.max(0, deadline - Date.now())
		const requestSignal =
			signal === undefined
				? AbortSignal.timeout(remaining)
				: AbortSignal.any([signal, AbortSignal.timeout(remaining)])

		try {
			const response = await fetch(url, { signal: requestSignal })
			if (response.ok) {
				const info: unknown = await response.json()
				if (isRecord(info) && isString(info['webSocketDebuggerUrl'])) {
					return info['webSocketDebuggerUrl']
				}
			}
		} catch (error) {
			if (signal?.aborted === true) throw error
			// Not ready yet — keep polling
		}

		const delay = Math.min(BROWSER_WAIT_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()))
		if (delay > 0) await waitForTimeout(delay, undefined, { signal })
	}

	throw new BrowserConnectionError(
		`CDP endpoint on port ${port} did not become ready within ${timeout}ms`,
		{ port, timeout },
	)
}

/**
 * Fetches the current CDP target list from a browser's `/json/list` endpoint.
 *
 * @remarks
 * The endpoint is a network boundary, so an unreachable host, a non-2xx
 * response, and a body that is not a JSON array each come back as a failed
 * `Result` carrying a coded `BrowserConnectionError`. An entry missing a
 * required string field is skipped rather than failing the whole list.
 *
 * @param port - Port the browser exposes its CDP endpoint on
 * @param timeout - Request timeout in milliseconds
 * @param host - Host the browser exposes its CDP endpoint on (default `127.0.0.1`)
 * @returns The normalized CDP targets, or the fault that stopped the request
 *
 * @example
 * ```ts
 * import { fetchCDPTargets } from '@orkestrel/browser/server'
 *
 * const result = await fetchCDPTargets(9222, 2000)
 * if (result.success) log(result.value.length)
 * else log(result.error.code)
 * ```
 */
export async function fetchCDPTargets(
	port: number,
	timeout: number,
	host: string = BROWSER_DEFAULT_HOST,
): Promise<Result<readonly CDPTarget[], BrowserError>> {
	const url = `${BROWSER_CDP_PROTOCOL}://${host}:${port}${BROWSER_CDP_LIST_PATH}`
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeout)

	try {
		const response = await fetch(url, { signal: controller.signal })

		if (!response.ok) {
			return {
				success: false,
				error: new BrowserConnectionError('CDP target list request was refused', {
					url,
					status: response.status,
				}),
			}
		}

		const list: unknown = await response.json()
		if (!isArray(list)) {
			return {
				success: false,
				error: new BrowserConnectionError('CDP target list is not a JSON array', { url }),
			}
		}

		const targets: CDPTarget[] = []
		for (const entry of list) {
			if (!isRecord(entry)) continue
			if (
				!isString(entry['id']) ||
				!isString(entry['type']) ||
				!isString(entry['title']) ||
				!isString(entry['url'])
			) {
				continue
			}

			targets.push({
				id: entry['id'],
				category: entry['type'],
				title: entry['title'],
				url: entry['url'],
			})
		}

		return { success: true, value: targets }
	} catch (error) {
		return {
			success: false,
			error: new BrowserConnectionError('CDP target list is unreachable', { url, error }),
		}
	} finally {
		clearTimeout(timer)
	}
}
