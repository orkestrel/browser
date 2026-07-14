import type { ChildProcess } from 'node:child_process'
import type { CDPTarget } from '@src/core'
import type { SystemBrowserOptions } from './types.js'
import { existsSync, globSync } from 'node:fs'
import { win32 as pathWin32, posix as pathPosix } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { isRecord, isString } from '@orkestrel/contract'
import { BROWSER_WAIT_POLL_INTERVAL_MS } from '@src/core'
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
	BROWSER_LAUNCH_ARGS,
	BROWSER_HEADLESS_ARG,
	BROWSER_DEFAULT_HOST,
} from './constants.js'

// === Discovery helpers

/**
 * Locate a Chrome/Chromium/Edge executable on this machine.
 *
 * @remarks
 * Resolution precedence (first match wins):
 * 1. `PLAYWRIGHT_EXECUTABLE_PATH`, then `CHROME_PATH` — an explicit
 *    environment override, when set and the file exists
 * 2. Well-known platform install locations (Chrome, Edge, Chromium); Windows
 *    roots are derived from `PROGRAMFILES` / `PROGRAMFILES(X86)` / `LOCALAPPDATA`
 * 3. PATH probe for known command names (`which` on POSIX, `where` on Windows)
 * 4. Playwright-managed browser stores (`PLAYWRIGHT_BROWSERS_PATH`, `/opt/pw-browsers`,
 *    and the per-OS Playwright cache directory) — the top-level `chromium`
 *    link/binary, else the highest-revision `chromium-*` install found
 *
 * @param options - Overrides for the candidate sources; see {@link SystemBrowserOptions}
 * @returns Absolute path to a browser executable, or undefined
 */
export function findSystemBrowser(options?: SystemBrowserOptions): string | undefined {
	const platform = process.platform
	const env = options?.env ?? process.env

	const envOverride = findEnvOverride(env)
	if (envOverride !== undefined) return envOverride

	const paths = options?.paths ?? defaultInstallPaths(platform, env)
	const installPath = findInstallPath(paths)
	if (installPath !== undefined) return installPath

	const names = options?.names ?? BROWSER_EXECUTABLE_NAMES
	const pathBinary = probePathNames(names, platform)
	if (pathBinary !== undefined) return pathBinary

	const stores = options?.stores ?? defaultStoreBases(env, platform)
	for (const store of stores) {
		const found = findInStore(store, platform)
		if (found !== undefined) return found
	}

	return undefined
}

/** Check the env-override keys (`PLAYWRIGHT_EXECUTABLE_PATH`, `CHROME_PATH`) in order for an existing file. */
export function findEnvOverride(env: Readonly<Record<string, string | undefined>>): string | undefined {
	for (const key of BROWSER_ENV_PATH_KEYS) {
		const value = env[key]
		if (value !== undefined && value.length > 0 && existsSync(value)) return value
	}
	return undefined
}

/** Build the default well-known install-path candidates for a platform, deriving Windows roots from env vars. */
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

/** Derive Windows install roots from env vars, falling back to well-known literals when absent. */
export function windowsRoots(env: Readonly<Record<string, string | undefined>>): readonly string[] {
	const programFiles = env['PROGRAMFILES'] ?? BROWSER_WINDOWS_ROOT_FALLBACKS['PROGRAMFILES']
	const programFilesX86 =
		env['PROGRAMFILES(X86)'] ?? BROWSER_WINDOWS_ROOT_FALLBACKS['PROGRAMFILES(X86)']
	const localAppData = env['LOCALAPPDATA']

	const roots = [programFiles, programFilesX86, localAppData]
	return roots.filter((root): root is string => root !== undefined)
}

/** Return the first candidate path that exists on disk. */
export function findInstallPath(paths: readonly string[]): string | undefined {
	for (const path of paths) {
		if (existsSync(path)) return path
	}
	return undefined
}

/** Probe PATH (`which`/`where`) for the first resolvable command name. */
export function probePathNames(names: readonly string[], platform: string): string | undefined {
	const finder = platform === 'win32' ? 'where' : 'which'
	for (const name of names) {
		const result = spawnSync(finder, [name], { stdio: 'pipe' })
		if (result.status === 0) {
			const output = result.stdout.toString('utf-8').trim().split('\n')[0]
			if (output !== undefined && output.length > 0) return output
		}
	}
	return undefined
}

/** Build the default Playwright browser store base directories to search for a managed Chromium. */
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

/** Search one store base for the top-level `chromium` link, else the highest-revision `chromium-*` install. */
export function findInStore(base: string, platform: string): string | undefined {
	const joiner = platform === 'win32' ? pathWin32.join : pathPosix.join

	const linkPath = joiner(base, BROWSER_STORE_LINK_NAME)
	if (existsSync(linkPath)) return linkPath

	const glob = BROWSER_STORE_GLOBS[platform]
	if (glob === undefined) return undefined

	const pattern = `${base.replaceAll('\\', '/')}/${glob}`
	const matches = globSync(pattern).filter((match) => existsSync(match))
	if (matches.length === 0) return undefined

	matches.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
	return matches[0]
}

/**
 * Launch a browser process with raw-CDP debugging flags.
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

	return spawn(executable, args, { stdio: 'ignore' })
}

/**
 * Poll a browser's CDP version endpoint until it responds or the timeout elapses.
 *
 * @param port - Port the browser exposes its CDP endpoint on
 * @param timeout - Maximum time to wait in milliseconds
 * @param host - Host the browser exposes its CDP endpoint on (default `127.0.0.1`)
 * @returns The browser's WebSocket debugger URL
 *
 * @throws When the endpoint does not become ready before the timeout
 */
export async function waitForCdpReady(
	port: number,
	timeout: number,
	host: string = BROWSER_DEFAULT_HOST,
): Promise<string> {
	const url = `${BROWSER_CDP_PROTOCOL}://${host}:${port}${BROWSER_CDP_VERSION_PATH}`
	const deadline = Date.now() + timeout

	while (Date.now() < deadline) {
		const remaining = Math.max(0, deadline - Date.now())
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), remaining)

		try {
			const response = await fetch(url, { signal: controller.signal })
			if (response.ok) {
				const info: unknown = await response.json()
				if (isRecord(info) && isString(info['webSocketDebuggerUrl'])) {
					return info['webSocketDebuggerUrl']
				}
			}
		} catch {
			// Not ready yet — keep polling
		} finally {
			clearTimeout(timer)
		}

		await new Promise((resolve) => setTimeout(resolve, BROWSER_WAIT_POLL_INTERVAL_MS))
	}

	throw new Error(`CDP endpoint on port ${port} did not become ready within ${timeout}ms`)
}

/**
 * Fetch the current CDP target list from a browser's `/json/list` endpoint.
 *
 * @param port - Port the browser exposes its CDP endpoint on
 * @param timeout - Request timeout in milliseconds
 * @param host - Host the browser exposes its CDP endpoint on (default `127.0.0.1`)
 * @returns Normalized CDP targets
 */
export async function fetchCdpTargets(
	port: number,
	timeout: number,
	host: string = BROWSER_DEFAULT_HOST,
): Promise<readonly CDPTarget[]> {
	const url = `${BROWSER_CDP_PROTOCOL}://${host}:${port}${BROWSER_CDP_LIST_PATH}`
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeout)

	try {
		const response = await fetch(url, { signal: controller.signal })

		if (!response.ok) return []

		const list: unknown = await response.json()
		if (!Array.isArray(list)) return []

		const targets: CDPTarget[] = []
		for (const entry of list) {
			if (!isRecord(entry)) continue
			if (!isString(entry['id']) || !isString(entry['type'])) continue

			targets.push({
				id: entry['id'],
				type: entry['type'],
				title: isString(entry['title']) ? entry['title'] : '',
				url: isString(entry['url']) ? entry['url'] : '',
			})
		}

		return targets
	} catch {
		return []
	} finally {
		clearTimeout(timer)
	}
}
