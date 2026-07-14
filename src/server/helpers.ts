import type { ChildProcess } from 'node:child_process'
import type { CDPTarget } from '@src/core'
import { existsSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { isRecord, isString } from '@orkestrel/contract'
import { BROWSER_WAIT_POLL_INTERVAL_MS } from '@src/core'
import {
	BROWSER_CDP_PROTOCOL,
	BROWSER_CDP_VERSION_PATH,
	BROWSER_CDP_LIST_PATH,
	BROWSER_EXECUTABLE_PATHS,
	BROWSER_EXECUTABLE_NAMES,
	BROWSER_LAUNCH_ARGS,
	BROWSER_HEADLESS_ARG,
} from './constants.js'

// === Discovery helpers

/**
 * Locate a Chrome/Chromium/Edge executable on this machine.
 *
 * @remarks
 * Checks well-known install paths for the current platform first, then
 * probes PATH for each known command name (`which` on POSIX, `where` on
 * Windows). Returns `undefined` when no executable is found (§12 — an
 * optional lookup, never throws).
 *
 * @returns Absolute path to a browser executable, or undefined
 */
export function findSystemBrowser(): string | undefined {
	const platform = process.platform
	const knownPaths = BROWSER_EXECUTABLE_PATHS[platform] ?? []

	for (const path of knownPaths) {
		if (existsSync(path)) return path
	}

	const finder = platform === 'win32' ? 'where' : 'which'
	for (const name of BROWSER_EXECUTABLE_NAMES) {
		const result = spawnSync(finder, [name], { stdio: 'pipe' })
		if (result.status === 0) {
			const output = result.stdout.toString('utf-8').trim().split('\n')[0]
			if (output !== undefined && output.length > 0) return output
		}
	}

	return undefined
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
	const args: string[] = [`--remote-debugging-port=${port}`, ...BROWSER_LAUNCH_ARGS]

	if (headless) args.push(BROWSER_HEADLESS_ARG)
	if (profile !== undefined) args.push(`--user-data-dir=${profile}`)
	if (extra !== undefined) args.push(...extra)

	return spawn(executable, args, { stdio: 'ignore' })
}

/**
 * Poll a browser's CDP version endpoint until it responds or the timeout elapses.
 *
 * @param port - Port the browser exposes its CDP endpoint on
 * @param timeout - Maximum time to wait in milliseconds
 * @returns The browser's WebSocket debugger URL
 *
 * @throws When the endpoint does not become ready before the timeout
 */
export async function waitForCdpReady(port: number, timeout: number): Promise<string> {
	const url = `${BROWSER_CDP_PROTOCOL}://localhost:${port}${BROWSER_CDP_VERSION_PATH}`
	const deadline = Date.now() + timeout

	while (Date.now() < deadline) {
		try {
			const response = await fetch(url)
			if (response.ok) {
				const info: unknown = await response.json()
				if (isRecord(info) && isString(info['webSocketDebuggerUrl'])) {
					return info['webSocketDebuggerUrl']
				}
			}
		} catch {
			// Not ready yet — keep polling
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
 * @returns Normalized CDP targets
 */
export async function fetchCdpTargets(
	port: number,
	timeout: number,
): Promise<readonly CDPTarget[]> {
	const url = `${BROWSER_CDP_PROTOCOL}://localhost:${port}${BROWSER_CDP_LIST_PATH}`

	try {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeout)

		const response = await fetch(url, { signal: controller.signal })
		clearTimeout(timer)

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
	}
}
