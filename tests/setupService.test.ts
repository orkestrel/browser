/**
 * Proof for `tests/setupService.ts`.
 *
 * The subject is the readiness contract the `service` project codes against: the shared
 * container-safe launch flags, the engine narrowing read from the environment, the
 * hard-required resolution that throws rather than skipping, the cited reason a live proof
 * may skip with, and the readers of a protocol domain list and an outline's references.
 *
 * Every case runs on any host, browserless included, because this file is collected by
 * the `setup` project that `npm test` runs. The refusal path is driven by handing
 * discovery candidate sources that resolve nothing, so the assertion never depends on
 * what happens to be installed. The last case reads the `tests/service` sources directly
 * and pins that each proof there resolves its browser through `requireSystemBrowser` and
 * that its only skip is conditional on a registry reading and names a reason exported here,
 * which is what keeps a later service proof from reintroducing a silent skip.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserOutlineNode } from '@src/core'
import { renderBrowserOutline } from '@src/core'
import { isString } from '@orkestrel/contract'
import * as setupService from './setupService.js'
import {
	extractOutlineReferences,
	parseProtocolDomains,
	REGISTRY_ABSENT_REASON,
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

describe('REGISTRY_ABSENT_REASON', () => {
	it('cites the protocol error code and the domain listing a live proof asserts before skipping', () => {
		expect(REGISTRY_ABSENT_REASON).toContain('WebMCP.enable answers CDP error -32601')
		expect(REGISTRY_ABSENT_REASON).toContain('Schema.getDomains lists no WebMCP domain')
	})
})

describe('parseProtocolDomains', () => {
	it('returns the listed domain names in reply order', () => {
		expect(
			parseProtocolDomains({
				domains: [
					{ name: 'Page', version: '1.3' },
					{ name: 'WebMCP', version: '1.3' },
				],
			}),
		).toStrictEqual(['Page', 'WebMCP'])
		expect(parseProtocolDomains({ domains: [] })).toStrictEqual([])
	})

	it('refuses a reply with no domain list or a domain with no string name', () => {
		expect(parseProtocolDomains(undefined)).toBeUndefined()
		expect(parseProtocolDomains([])).toBeUndefined()
		expect(parseProtocolDomains({ domains: { name: 'Page' } })).toBeUndefined()
		expect(
			parseProtocolDomains({ domains: [{ name: 'Page' }, { version: '1.3' }] }),
		).toBeUndefined()
		expect(parseProtocolDomains({ domains: [{ name: 7 }] })).toBeUndefined()
		expect(parseProtocolDomains({ domains: ['Page'] })).toBeUndefined()
	})
})

describe('extractOutlineReferences', () => {
	it('reads the reference of every element row the outline renderer writes, in row order', () => {
		const nodes: readonly BrowserOutlineNode[] = [
			['7', 'textbox', 'Name', 'e3'],
			['8', 'heading', 'Delivery form', undefined],
			['9', 'button', 'Submit', 'e12'],
		].map(([id, role, name, reference]) => ({
			id: id ?? '',
			parent: undefined,
			children: [],
			backend: Number(id),
			frame: 'main',
			ignored: false,
			role,
			name,
			description: undefined,
			value: undefined,
			properties: {},
			session: 'session',
			reference,
		}))
		const outline = renderBrowserOutline('http://127.0.0.1/form', 'Delivery form', nodes, 150)

		expect(extractOutlineReferences(outline.text)).toStrictEqual([3, 12])
	})

	it('extracts nothing from heading, text, and summary rows or from an empty outline', () => {
		expect(
			extractOutlineReferences(
				'page "Form" http://127.0.0.1/form\n# e5 heading\ne0 zero\nLeave e7 at the door\n(0 of 0 elements)',
			),
		).toStrictEqual([])
		expect(extractOutlineReferences('')).toStrictEqual([])
	})
})

describe('tests/service readiness', () => {
	it('resolves its browser through requireSystemBrowser in every service proof and skips only with a reason this module cites', () => {
		const proofs = readdirSync(SERVICE_DIRECTORY).filter((name) => name.endsWith('.test.ts'))
		const reasons = Object.entries(setupService)
			.filter(([name, value]) => name.endsWith('_REASON') && isString(value))
			.map(([name]) => name)

		expect(proofs.length).toBeGreaterThan(0)
		expect(reasons).toContain('REGISTRY_ABSENT_REASON')
		for (const proof of proofs) {
			const source = readFileSync(join(SERVICE_DIRECTORY, proof), 'utf8')
			const skips = [...source.matchAll(/\.skip(?:If)?\(([^)]*)\)/g)].map((match) => match[1])
			expect(source).toContain('requireSystemBrowser(')
			expect(source).not.toContain('.runIf(')
			expect(
				skips.filter(
					(argument) => !reasons.includes(/^!\w+, (\w+)$/.exec(argument ?? '')?.[1] ?? ''),
				),
			).toStrictEqual([])
		}
	})
})
