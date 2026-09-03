/**
 * Proof for `tests/setupService.ts`.
 *
 * The subject is the readiness contract the `service` project codes against: the shared
 * container-safe launch flags, the engine narrowing read from the environment, and the
 * hard-required resolution that throws rather than skipping.
 *
 * Every case runs on any host, browserless included, because this file is collected by
 * the `setup` project that `npm test` runs. The refusal path is driven by handing
 * discovery candidate sources that resolve nothing, so the assertion never depends on
 * what happens to be installed. The last case reads the `tests/service` sources directly
 * and pins that each proof there resolves its browser through `requireSystemBrowser`,
 * which is what keeps a later service proof from reintroducing a silent skip.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	requireSystemBrowser,
	resolveServiceEngine,
	SERVICE_BROWSER_ARGS,
	SERVICE_ENGINE_ENV_KEY,
} from './setupService.js'

const SERVICE_DIRECTORY = fileURLToPath(new URL('service/', import.meta.url))

describe('SERVICE_BROWSER_ARGS', () => {
	it('carries the container-safe flags as a frozen list', () => {
		expect([...SERVICE_BROWSER_ARGS]).toStrictEqual([
			'--no-sandbox',
			'--disable-dev-shm-usage',
			'--disable-gpu',
		])
		expect(Object.isFrozen(SERVICE_BROWSER_ARGS)).toBe(true)
	})
})

describe('SERVICE_ENGINE_ENV_KEY', () => {
	it('names the environment variable the compatibility matrix sets', () => {
		expect(SERVICE_ENGINE_ENV_KEY).toBe('BROWSER_COMPATIBILITY_ENGINE')
	})
})

describe('resolveServiceEngine', () => {
	it('accepts each supported engine name', () => {
		expect(resolveServiceEngine('chromium')).toBe('chromium')
		expect(resolveServiceEngine('chrome')).toBe('chrome')
		expect(resolveServiceEngine('edge')).toBe('edge')
	})

	it('leaves discovery open for an absent, empty, or unsupported value', () => {
		expect(resolveServiceEngine(undefined)).toBeUndefined()
		expect(resolveServiceEngine('')).toBeUndefined()
		expect(resolveServiceEngine('firefox')).toBeUndefined()
		expect(resolveServiceEngine('Chrome')).toBeUndefined()
	})
})

describe('requireSystemBrowser', () => {
	it('throws a message naming the install routes when every candidate source is empty', () => {
		expect(() => requireSystemBrowser({ env: {}, paths: [], names: [], stores: [] })).toThrow(
			'The service project requires a Chromium-family browser on this host and found none.',
		)
		expect(() => requireSystemBrowser({ env: {}, paths: [], names: [], stores: [] })).toThrow(
			'PLAYWRIGHT_EXECUTABLE_PATH or CHROME_PATH',
		)
	})

	it('returns the executable an explicit candidate path supplies', () => {
		const executable = fileURLToPath(new URL('setupService.ts', import.meta.url))

		expect(
			requireSystemBrowser({ env: {}, paths: [executable], names: [], stores: [] }),
		).toStrictEqual({ executable, engine: 'chromium' })
	})
})

describe('tests/service readiness', () => {
	it('resolves its browser through requireSystemBrowser in every service proof', () => {
		const proofs = readdirSync(SERVICE_DIRECTORY).filter((name) => name.endsWith('.test.ts'))

		expect(proofs.length).toBeGreaterThan(0)
		for (const proof of proofs) {
			const source = readFileSync(join(SERVICE_DIRECTORY, proof), 'utf8')
			expect(source).toContain('requireSystemBrowser(')
			expect(source).not.toContain('.runIf(')
			expect(source).not.toContain('.skip(')
		}
	})
})
