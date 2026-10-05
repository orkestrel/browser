import type { TestProject } from 'vitest/node'
import type {
	BrowserInterface,
	BrowserOptions,
	SystemBrowser,
	SystemBrowserOptions,
} from '@src/server'
import type { Server } from 'node:http'
import type { Plugin } from 'vite'
import type { ScratchInterface } from '@orkestrel/test/server'
import { createServer, request } from 'node:http'
import { fileURLToPath } from 'node:url'
import { isArray, isRecord, isString } from '@orkestrel/contract'
import { createTeardown } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import { createServer as createViteServer } from 'vite'

declare module 'vitest' {
	interface ProvidedContext {
		/** The static fixture server's loopback origin. */
		readonly server: string
		/** The CDP WebSocket endpoint of a Chromium that allows every origin. */
		readonly endpoint: string
		/** The browser product advertised by the endpoint's HTTP discovery reply. */
		readonly product: string
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
	createBrowser(
		options?: BrowserOptions,
	): Pick<BrowserInterface, 'connect' | 'discover' | 'destroy'>
}

/** Describes the `tests/setupService.ts` exports the launcher loads beside it. */
export interface BrowserServiceModuleInterface {
	readonly SERVICE_BROWSER_ARGS: readonly string[]
	requireSystemBrowser(options?: SystemBrowserOptions): SystemBrowser
	reservePort(): Promise<number>
}

/** Launches Chromium browsers through this package's own `createBrowser`. */
export interface BrowserLauncherInterface {
	/** Launches one headless Chromium with the given flags added to the service flags. */
	launch(args: readonly string[]): Promise<BrowserEndpointInterface>
	/**
	 * Reports whether the isolated module graph still watches workspace files: `true` while its
	 * runner is open, `false` after `close` released it.
	 */
	readonly watching: boolean
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
 * @returns True if the module exports the service flags, `requireSystemBrowser`, and `reservePort`; false
 * otherwise
 */
export function isBrowserServiceModule(value: unknown): value is BrowserServiceModuleInterface {
	return (
		isRecord(value) &&
		typeof value['requireSystemBrowser'] === 'function' &&
		typeof value['reservePort'] === 'function' &&
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
 * load through a separate runner that declares only the workspace aliases. The runner's
 * `closeServer` hook runs after its full shutdown settles, so a plugin that implements it
 * observes the launcher's `close` completing.
 *
 * @param plugins - The Vite plugins the runner loads. Default: none
 * @returns The launcher; close it after its browsers are destroyed
 * @throws Thrown when a loaded module lacks the exports the launcher calls.
 */
export async function createBrowserLauncher(
	plugins: readonly Plugin[] = [],
): Promise<BrowserLauncherInterface> {
	const runner = await createViteServer({
		configFile: false,
		root: fileURLToPath(new URL('../', import.meta.url)),
		appType: 'custom',
		logLevel: 'silent',
		plugins: [...plugins],
		resolve: {
			alias: {
				'@src/core': fileURLToPath(new URL('../src/core/index.ts', import.meta.url)),
				'@src/server': fileURLToPath(new URL('../src/server/index.ts', import.meta.url)),
			},
		},
		// The watcher scans its tree at startup; scratch under tmp/ can hold tens of thousands of files.
		server: { middlewareMode: true, ws: false, watch: { ignored: ['**/tmp/**'] } },
	})
	try {
		const server: unknown = await runner.ssrLoadModule('/src/server/index.ts')
		const service: unknown = await runner.ssrLoadModule('/tests/setupService.ts')
		if (!isBrowserServerModule(server) || !isBrowserServiceModule(service)) {
			throw new Error(
				'the launcher modules lack createBrowser, service flags, requireSystemBrowser, or reservePort',
			)
		}
		return {
			launch(args: readonly string[]): Promise<BrowserEndpointInterface> {
				return launchBrowserEndpoint(server, service, args)
			},
			get watching(): boolean {
				return Object.keys(runner.watcher.getWatched()).length > 0
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
 * @remarks
 * The launch owns the profile from the moment it is passed in. Every acquisition after it (the
 * port, the browser, the connection) runs inside one rollback boundary: when a step throws, the
 * browser is destroyed and the profile removed, even when the destruction rejects, and the
 * launch rejects with the step's error, or with an `AggregateError` carrying it and the
 * cleanup's error. The returned `destroy` attempts both releases the same way.
 *
 * @param server - The loaded `@src/server` module
 * @param service - The loaded service setup module
 * @param args - The launch flags added to the container-safe service flags
 * @param profile - The scratch directory the browser uses as its profile. Default: a fresh one
 * @returns The browser's CDP endpoint and its teardown
 * @throws Thrown when the host has no Chromium-family browser or the launch reports no endpoint.
 */
export async function launchBrowserEndpoint(
	server: BrowserServerModuleInterface,
	service: BrowserServiceModuleInterface,
	args: readonly string[],
	profile: ScratchInterface = createScratch({ prefix: 'orkestrel-browser-global-' }),
): Promise<BrowserEndpointInterface> {
	const teardown = createTeardown()
	teardown.add(() => profile.destroy())
	try {
		const browser = server.createBrowser({
			executable: service.requireSystemBrowser().executable,
			headless: true,
			profile: profile.path,
			args: [...service.SERVICE_BROWSER_ARGS, ...args],
			cdp: { port: await service.reservePort() },
			timeout: 20_000,
		})
		teardown.add(() => browser.destroy())
		await browser.connect()
		const { endpoint } = await browser.discover()
		if (endpoint === undefined) throw new Error('the launched browser reports no CDP endpoint')
		return {
			endpoint,
			destroy(): Promise<void> {
				return teardown.destroy()
			},
		}
	} catch (error) {
		await teardown.destroy().catch((cleanup: unknown) => {
			throw new AggregateError([error, cleanup], 'The launch failed and its rollback failed', {
				cause: error,
			})
		})
		throw error
	}
}

/**
 * Creates the minimal browser handle a launch drives, whose connection fails and whose
 * termination fails or succeeds as given, so a proof can drive the launch's rollback.
 *
 * @param connect - The error `connect` rejects with
 * @param destroy - The error `destroy` rejects with, or `undefined` for a termination that succeeds
 * @returns The handle `createBrowser` would return
 */
export function createFailingBrowser(
	connect: Error,
	destroy: Error | undefined,
): Pick<BrowserInterface, 'connect' | 'discover' | 'destroy'> {
	return {
		connect: () => Promise.reject(connect),
		discover: () => Promise.resolve({ endpoint: undefined, browser: undefined }),
		destroy: () => (destroy === undefined ? Promise.resolve() : Promise.reject(destroy)),
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
 * Closes a listening server and waits for its close.
 *
 * @param server - The listening server
 * @returns A promise that settles when the server closed
 * @throws Thrown when the server was not listening.
 */
export function closeFixtureServer(server: Server): Promise<void> {
	return new Promise<void>((done, fail) => {
		server.close((error) => (error === undefined ? done() : fail(error)))
	})
}

/**
 * Starts a loopback fixture server and two Chromium browsers before the browser test graph runs.
 *
 * @remarks
 * Both browsers launch through {@link createBrowserLauncher}. The one launched with
 * {@link REMOTE_ORIGINS_FLAG} is provided as `endpoint`; the control launched without it is
 * provided as `endpointWithoutFlag`, so a browser proof spawns nothing. Every acquisition and
 * publication runs inside one rollback boundary: when a step throws, every resource already
 * acquired is released before the error propagates, and the returned teardown attempts every
 * release even when one rejects.
 *
 * @param project - The Vitest project receiving the fixture origin and the endpoints
 * @param launch - Acquires the launcher. Default: {@link createBrowserLauncher}
 * @returns A teardown that terminates both browsers, closes the launcher, and closes the server
 * @throws Thrown when a step fails; an `AggregateError` carrying the failure and the rollback's
 * failure when the rollback fails too.
 */
export async function setup(
	project: Pick<TestProject, 'provide'>,
	launch: () => Promise<BrowserLauncherInterface> = createBrowserLauncher,
): Promise<() => Promise<void>> {
	const teardown = createTeardown()
	try {
		const server = createServer((_request, response) => {
			response.setHeader('access-control-allow-origin', '*')
			response.setHeader('content-type', 'text/html; charset=utf-8')
			response.end('<!doctype html><title>fixture</title>')
		})
		await new Promise<void>((done, fail) => {
			server.once('error', fail)
			server.listen(0, '127.0.0.1', done)
		})
		teardown.add(() => closeFixtureServer(server))
		const address = server.address()
		if (address === null || typeof address === 'string')
			throw new Error('fixture server has no port')
		const launcher = await launch()
		teardown.add(() => launcher.close())
		const launched = await Promise.allSettled([
			launcher.launch([REMOTE_ORIGINS_FLAG]),
			launcher.launch([]),
		])
		const browsers = launched.flatMap((result) =>
			result.status === 'fulfilled' ? [result.value] : [],
		)
		// Both browsers terminate in parallel; the handler rethrows every failure after both ran.
		teardown.add(async () => {
			const released = await Promise.allSettled(browsers.map((browser) => browser.destroy()))
			const failures = released.flatMap((result) =>
				result.status === 'rejected' ? [result.reason] : [],
			)
			if (failures.length > 0) throw new AggregateError(failures, 'a browser did not terminate')
		})
		const [flagged, control] = launched
		if (flagged?.status !== 'fulfilled') throw flagged?.reason
		if (control?.status !== 'fulfilled') throw control?.reason
		const discovery = new URL('/json/version', flagged.value.endpoint)
		discovery.protocol = discovery.protocol === 'wss:' ? 'https:' : 'http:'
		const response = await fetch(discovery)
		if (!response.ok) throw new Error('browser discovery did not answer')
		const version: unknown = await response.json()
		if (!isRecord(version) || !isString(version['Browser']) || version['Browser'].length === 0)
			throw new Error('browser discovery returned no product')
		project.provide('product', version['Browser'])
		project.provide('server', `http://127.0.0.1:${address.port}`)
		project.provide('endpoint', flagged.value.endpoint)
		project.provide('endpointWithoutFlag', control.value.endpoint)
		return () => teardown.destroy()
	} catch (error) {
		await teardown.destroy().catch((cleanup: unknown) => {
			throw new AggregateError(
				[error, cleanup],
				'The global setup failed and its rollback failed',
				{
					cause: error,
				},
			)
		})
		throw error
	}
}
