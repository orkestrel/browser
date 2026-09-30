import type { TestProject } from 'vitest/node'
import type {
	BrowserInterface,
	BrowserOptions,
	SystemBrowser,
	SystemBrowserOptions,
} from '@src/server'
import { createServer, request } from 'node:http'
import { fileURLToPath } from 'node:url'
import { isArray, isRecord, isString } from '@orkestrel/contract'
import { createScratch } from '@orkestrel/test/server'
import { createServer as createViteServer } from 'vite'
import { reservePort } from './setupServer.js'

declare module 'vitest' {
	interface ProvidedContext {
		/** The static fixture server's loopback origin. */
		readonly server: string
		/** The CDP WebSocket endpoint of a Chromium that allows every origin. */
		readonly endpoint: string
		/** The CDP WebSocket endpoint of a Chromium launched without `--remote-allow-origins`. */
		readonly endpointWithoutFlag: string
	}
}

/** Names the flag that lets a page's `WebSocket` reach the Chromium the browser proofs drive. */
export const REMOTE_ORIGINS_FLAG = '--remote-allow-origins=*'

/** Holds one Chromium the global setup launched and the endpoint it serves. */
export interface BrowserEndpointInterface {
	/** The browser-level CDP WebSocket endpoint. */
	readonly endpoint: string
	/** Terminates the browser and removes its profile. */
	destroy(): Promise<void>
}

/** Describes the `@src/server` export the launcher loads into its isolated Node-side graph. */
export interface BrowserServerModuleInterface {
	createBrowser(options?: BrowserOptions): BrowserInterface
}

/** Describes the `tests/setupService.ts` exports the launcher loads beside it. */
export interface BrowserServiceModuleInterface {
	readonly SERVICE_BROWSER_ARGS: readonly string[]
	requireSystemBrowser(options?: SystemBrowserOptions): SystemBrowser
}

/** Launches Chromium browsers through this package's own `createBrowser`. */
export interface BrowserLauncherInterface {
	/** Launches one headless Chromium with the given flags added to the service flags. */
	launch(args: readonly string[]): Promise<BrowserEndpointInterface>
	/** Closes the isolated module graph the launcher loaded `createBrowser` through. */
	close(): Promise<void>
}

/**
 * Narrows a loaded module to the `@src/server` export the launcher calls.
 *
 * @param value - The loaded module namespace
 * @returns True if the module exports a `createBrowser` function; false otherwise
 */
export function isBrowserServerModule(value: unknown): value is BrowserServerModuleInterface {
	return isRecord(value) && typeof value['createBrowser'] === 'function'
}

/**
 * Narrows a loaded module to the service-setup exports the launcher reads.
 *
 * @param value - The loaded module namespace
 * @returns True if the module exports the service flags and `requireSystemBrowser`; false
 * otherwise
 */
export function isBrowserServiceModule(value: unknown): value is BrowserServiceModuleInterface {
	return (
		isRecord(value) &&
		typeof value['requireSystemBrowser'] === 'function' &&
		isArray(value['SERVICE_BROWSER_ARGS']) &&
		value['SERVICE_BROWSER_ARGS'].every((flag) => isString(flag))
	)
}

/**
 * Creates a launcher that loads `createBrowser` into an isolated Node-side Vite graph.
 *
 * @remarks
 * A browser project's own graph refuses a server module through its environment boundary, and
 * the global setup runs inside that graph, so `@src/server` and the service setup that imports it
 * load through a separate runner that declares only the workspace aliases.
 *
 * @returns The launcher; close it after its browsers are destroyed
 * @throws Thrown when a loaded module lacks the exports the launcher calls.
 */
export async function createBrowserLauncher(): Promise<BrowserLauncherInterface> {
	const runner = await createViteServer({
		configFile: false,
		root: fileURLToPath(new URL('../', import.meta.url)),
		appType: 'custom',
		logLevel: 'silent',
		resolve: {
			alias: {
				'@src/core': fileURLToPath(new URL('../src/core/index.ts', import.meta.url)),
				'@src/server': fileURLToPath(new URL('../src/server/index.ts', import.meta.url)),
			},
		},
		server: { middlewareMode: true, ws: false },
	})
	try {
		const server: unknown = await runner.ssrLoadModule('/src/server/index.ts')
		const service: unknown = await runner.ssrLoadModule('/tests/setupService.ts')
		if (!isBrowserServerModule(server) || !isBrowserServiceModule(service)) {
			throw new Error('the launcher modules do not export createBrowser and the service flags')
		}
		return {
			launch(args: readonly string[]): Promise<BrowserEndpointInterface> {
				return launchBrowserEndpoint(server, service, args)
			},
			close(): Promise<void> {
				return runner.close()
			},
		}
	} catch (error) {
		await runner.close()
		throw error
	}
}

/**
 * Launches a headless Chromium through `createBrowser` with a temporary profile.
 *
 * @param server - The loaded `@src/server` module
 * @param service - The loaded service setup module
 * @param args - The launch flags added to the container-safe service flags
 * @returns The browser's CDP endpoint and its teardown
 * @throws Thrown when the host has no Chromium-family browser or the launch reports no endpoint.
 */
export async function launchBrowserEndpoint(
	server: BrowserServerModuleInterface,
	service: BrowserServiceModuleInterface,
	args: readonly string[],
): Promise<BrowserEndpointInterface> {
	const profile = createScratch({ prefix: 'orkestrel-browser-global-' })
	const browser = server.createBrowser({
		executable: service.requireSystemBrowser().executable,
		headless: true,
		profile: profile.path,
		args: [...service.SERVICE_BROWSER_ARGS, ...args],
		cdp: { port: await reservePort() },
		timeout: 20_000,
	})
	try {
		await browser.connect()
		const { endpoint } = await browser.discover()
		if (endpoint === undefined) throw new Error('the launched browser reports no CDP endpoint')
		return {
			endpoint,
			async destroy(): Promise<void> {
				await browser.destroy()
				profile.destroy()
			},
		}
	} catch (error) {
		await browser.destroy()
		profile.destroy()
		throw error
	}
}

/**
 * Requests a WebSocket upgrade from an endpoint with an `Origin` header and reports the answer.
 *
 * @param endpoint - The `ws:` endpoint to upgrade against
 * @param origin - The `Origin` header value a browser page would send
 * @returns `101` when the endpoint accepts the upgrade, otherwise the refusing status code
 */
export function readUpgradeStatus(endpoint: string, origin: string): Promise<number> {
	const url = new URL(endpoint)
	url.protocol = 'http:'
	const answered = Promise.withResolvers<number>()
	const upgrade = request(url, {
		headers: {
			Connection: 'Upgrade',
			Upgrade: 'websocket',
			Origin: origin,
			'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
			'Sec-WebSocket-Version': '13',
		},
	})
	upgrade.once('upgrade', (_response, socket) => {
		socket.destroy()
		answered.resolve(101)
	})
	upgrade.once('response', (response) => {
		response.resume()
		answered.resolve(response.statusCode ?? 0)
	})
	upgrade.once('error', answered.reject)
	upgrade.end()
	return answered.promise
}

/**
 * Starts a loopback fixture server and two Chromium browsers before the browser test graph runs.
 *
 * @remarks
 * Both browsers launch through {@link createBrowserLauncher}. The one launched with
 * {@link REMOTE_ORIGINS_FLAG} is provided as `endpoint`; the control launched without it is provided as `endpointWithoutFlag`, so a browser proof spawns nothing.
 *
 * @param project - The Vitest project receiving the fixture origin and the endpoints
 * @returns A teardown that terminates both browsers and closes the server
 */
export async function setup(project: Pick<TestProject, 'provide'>): Promise<() => Promise<void>> {
	const server = createServer((_request, response) => {
		response.setHeader('access-control-allow-origin', '*')
		response.setHeader('content-type', 'text/html; charset=utf-8')
		response.end('<!doctype html><title>fixture</title>')
	})
	await new Promise<void>((done, fail) => {
		server.once('error', fail)
		server.listen(0, '127.0.0.1', done)
	})
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('fixture server has no port')
	const { port } = address
	const launcher = await createBrowserLauncher()
	const launched = await Promise.allSettled([
		launcher.launch([REMOTE_ORIGINS_FLAG]),
		launcher.launch([]),
	])
	const browsers = launched.flatMap((result) =>
		result.status === 'fulfilled' ? [result.value] : [],
	)
	const failure = launched.find((result) => result.status === 'rejected')
	const [flagged, control] = browsers
	if (failure !== undefined || flagged === undefined || control === undefined) {
		await Promise.all(browsers.map((browser) => browser.destroy()))
		await launcher.close()
		await new Promise<void>((done) => server.close(() => done()))
		throw failure?.reason ?? new Error('the global setup launched no browser')
	}
	project.provide('server', `http://127.0.0.1:${port}`)
	project.provide('endpoint', flagged.endpoint)
	project.provide('endpointWithoutFlag', control.endpoint)
	return async () => {
		await Promise.all([flagged.destroy(), control.destroy()])
		await launcher.close()
		await new Promise<void>((done, fail) => {
			server.close((error) => (error === undefined ? done() : fail(error)))
		})
	}
}
