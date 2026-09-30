import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { isString } from '@orkestrel/contract'
import { ignoreCall } from './setup.js'
import {
	closeFixtureServer,
	createBrowserLauncher,
	isBrowserServerModule,
	isBrowserServiceModule,
	readUpgradeStatus,
	REMOTE_ORIGINS_FLAG,
	setup,
} from './setupGlobal.js'

const PAGE_ORIGIN = 'http://page.example'

describe('setup', () => {
	it('provides the fixture origin and both browser endpoints, and releases them on teardown', async () => {
		const provided = new Map<string, unknown>()
		const teardown = await setup({
			provide: (key: string, value: unknown) => {
				provided.set(key, value)
			},
		})
		const origin = provided.get('server')
		const endpoint = provided.get('endpoint')
		const control = provided.get('endpointWithoutFlag')
		try {
			expect([...provided.keys()].sort()).toEqual(['endpoint', 'endpointWithoutFlag', 'server'])
			expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
			expect(endpoint).toMatch(/^ws:\/\/[^/]+\/devtools\/browser\/[\w-]+$/)
			expect(control).toMatch(/^ws:\/\/[^/]+\/devtools\/browser\/[\w-]+$/)
			expect(control).not.toBe(endpoint)
			if (!isString(origin) || !isString(endpoint) || !isString(control)) {
				throw new Error('a provided value is not a string')
			}
			const answered = await fetch(origin + '/')
			expect(answered.status).toBe(200)
			expect(answered.headers.get('access-control-allow-origin')).toBe('*')
			expect(await readUpgradeStatus(endpoint, PAGE_ORIGIN)).toBe(101)
			expect(await readUpgradeStatus(control, PAGE_ORIGIN)).toBe(403)
		} finally {
			await teardown()
		}
		if (!isString(origin) || !isString(endpoint) || !isString(control)) {
			throw new Error('a provided value is missing')
		}
		await expect(fetch(origin + '/')).rejects.toThrow(/fetch/i)
		await expect(readUpgradeStatus(endpoint, PAGE_ORIGIN)).rejects.toThrow(/ECONNREFUSED/)
		await expect(readUpgradeStatus(control, PAGE_ORIGIN)).rejects.toThrow(/ECONNREFUSED/)
	}, 20_000)

	it('releases every acquired resource when a later step throws', async () => {
		const provided = new Map<string, unknown>()
		const failure = await setup({
			provide: (key: string, value: unknown) => {
				provided.set(key, value)
				if (key === 'endpointWithoutFlag') throw new Error('provide failed')
			},
		}).catch((error: unknown) => error)
		expect(failure).toBeInstanceOf(Error)
		expect(failure instanceof Error && failure.message).toBe('provide failed')
		const origin = provided.get('server')
		const endpoint = provided.get('endpoint')
		const control = provided.get('endpointWithoutFlag')
		if (!isString(origin) || !isString(endpoint) || !isString(control)) {
			throw new Error('a provided value is missing')
		}
		await expect(fetch(origin + '/')).rejects.toThrow(/fetch/i)
		await expect(readUpgradeStatus(endpoint, PAGE_ORIGIN)).rejects.toThrow(/ECONNREFUSED/)
		await expect(readUpgradeStatus(control, PAGE_ORIGIN)).rejects.toThrow(/ECONNREFUSED/)
	}, 20_000)
})

describe('closeFixtureServer', () => {
	it('closes a listening server and rejects for one that is not listening', async () => {
		const server = createServer()
		await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
		await closeFixtureServer(server)
		expect(server.listening).toBe(false)
		await expect(closeFixtureServer(server)).rejects.toThrow(/not running/)
	})
})

describe('createBrowserLauncher', () => {
	it('launches an endpoint that accepts a page origin only with the allow-origins flag', async () => {
		const launcher = await createBrowserLauncher()
		try {
			const flagged = await launcher.launch([REMOTE_ORIGINS_FLAG])
			try {
				expect(await readUpgradeStatus(flagged.endpoint, PAGE_ORIGIN)).toBe(101)
			} finally {
				await flagged.destroy()
			}
			await expect(readUpgradeStatus(flagged.endpoint, PAGE_ORIGIN)).rejects.toThrow(/ECONNREFUSED/)
		} finally {
			await launcher.close()
		}
	}, 20_000)
})

describe('isBrowserServerModule', () => {
	it('admits a module exporting createBrowser and refuses one without it', () => {
		expect(isBrowserServerModule({ createBrowser: ignoreCall })).toBe(true)
		expect(isBrowserServerModule({ createBrowser: 'createBrowser' })).toBe(false)
		expect(isBrowserServerModule(null)).toBe(false)
	})
})

describe('isBrowserServiceModule', () => {
	it('admits the service exports and refuses a non-string flag', () => {
		const requireSystemBrowser = ignoreCall
		expect(isBrowserServiceModule({ requireSystemBrowser, SERVICE_BROWSER_ARGS: ['--a'] })).toBe(
			true,
		)
		expect(isBrowserServiceModule({ requireSystemBrowser, SERVICE_BROWSER_ARGS: [1] })).toBe(false)
		expect(isBrowserServiceModule({ SERVICE_BROWSER_ARGS: [] })).toBe(false)
	})
})
