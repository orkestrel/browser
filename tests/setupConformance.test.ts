import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { requireValue } from '@orkestrel/test'
import { createScratch } from '@orkestrel/test/server'
import {
	WEBMCP_INDEX,
	WEBMCP_INDEX_PATH,
	WEBMCP_INDEX_DIGEST,
	WEBMCP_WEBREF,
	WEBMCP_WEBREF_PATH,
	WEBMCP_WEBREF_DIGEST,
	WEBMCP_DOMAIN,
	WEBMCP_DOMAIN_PATH,
	WEBMCP_DOMAIN_DIGEST,
	WEBMCP_DOMAIN_RANGE,
	WEBMCP_TOOL,
	WEBMCP_TOOL_FIELDS,
	readMirror,
	readMirrorText,
	readIDLBlock,
	readDomainRecords,
	readDomainRecord,
	readParserFields,
	buildDomainRows,
	formatConformanceDrift,
	readConformanceDrift,
	readConformanceExports,
	readAdoptionModel,
	readSkipModel,
	WEBMCP_MAPPING_ROWS,
	WEBMCP_SKIP_ROWS,
	WEBMCP_GAPS,
	WEBMCP_WPT_LISTING_PATH,
	WEBMCP_WPT_ENTRIES,
} from './setupConformance.js'
import { parseBrowserTool } from '@src/core'

describe('conformance infrastructure', () => {
	it('returns the pinned bytes and rejects a scratch mirror with one changed byte', () => {
		const scratch = createScratch({ parent: 'tmp', prefix: 'u17-mirror-' })
		try {
			for (const [path, digest, bytes] of [
				[WEBMCP_INDEX_PATH, WEBMCP_INDEX_DIGEST, WEBMCP_INDEX],
				[WEBMCP_WEBREF_PATH, WEBMCP_WEBREF_DIGEST, WEBMCP_WEBREF],
				[WEBMCP_DOMAIN_PATH, WEBMCP_DOMAIN_DIGEST, WEBMCP_DOMAIN],
			] as const) {
				expect(readMirror(path, digest)).toEqual(bytes)
				const changed = Uint8Array.from(bytes)
				changed[0] = (changed[0] ?? 0) ^ 1
				const target = scratch.write('changed.mirror', '')
				writeFileSync(target, changed)
				expect(() => readMirror(target, digest)).toThrow(
					formatConformanceDrift('changed.mirror bytes', 'SHA-256', digest),
				)
			}
		} finally {
			scratch.destroy()
		}
		expect(WEBMCP_DOMAIN.byteLength).toBe(WEBMCP_DOMAIN_RANGE.end - WEBMCP_DOMAIN_RANGE.start)
	})

	it('reports an unequal row and accepts equal composite readings', () => {
		expect(readConformanceDrift('name', true, 'source', false)).toBe('name drifted; source=false')
		expect(readConformanceDrift('members', ['name'], 'source', ['name'])).toBeUndefined()
		expect(
			readConformanceDrift('hints', { pure: false, untrusted: true }, 'source', {
				untrusted: true,
				pure: false,
			}),
		).toBeUndefined()
	})

	it('reads UTF-8, requires IDL blocks, and refuses malformed protocol collections', () => {
		expect(readMirrorText(WEBMCP_WEBREF)).toContain('interface ModelContext')
		expect(readIDLBlock(readMirrorText(WEBMCP_WEBREF), 'ModelContext')).toContain('registerTool')
		expect(() => readIDLBlock('', 'Missing')).toThrow('Missing IDL block: Missing')
		expect(readDomainRecords({ types: [{ id: 'Tool' }] }, 'types')).toEqual([{ id: 'Tool' }])
		expect(() => readDomainRecords({}, 'types')).toThrow('Missing protocol collection: types')
		expect(() => readDomainRecords({ types: [3] }, 'types')).toThrow(
			'Missing protocol collection: types',
		)
		expect(readDomainRecord([{ id: 'Tool' }], 'Tool')).toEqual({ id: 'Tool' })
		expect(() => readDomainRecord([], 'Missing')).toThrow('Missing protocol record: Missing')
	})

	it('records real parser reads and rules every Tool property including the exclusion', () => {
		expect(readParserFields(parseBrowserTool, WEBMCP_TOOL)).toEqual(WEBMCP_TOOL_FIELDS)
		expect(WEBMCP_TOOL_FIELDS).toContain('backendNodeId')
		const rows = buildDomainRows('Tool', WEBMCP_TOOL_FIELDS)
		expect(rows).toHaveLength(7)
		expect(rows.find((row) => row.symbol === 'Tool.stackTrace')).toMatchObject({
			expected: false,
			model: false,
			ruling: 'exclude',
		})
		expect(() => buildDomainRows('Absent', [])).toThrow('Missing protocol record: Absent')
	})

	it('enumerates type aliases and star exports and refuses a missing source entry', () => {
		const scratch = createScratch({ parent: 'tmp', prefix: 'u17-export-reader-' })
		try {
			scratch.write(
				'definitions.ts',
				'export interface Entry { readonly value: string }\nexport const present = true\n',
			)
			const path = scratch.write(
				'index.ts',
				"export * from './definitions.js'\nexport type { Entry as NamedEntry } from './definitions.js'\n",
			)
			expect(readConformanceExports([path]).get(path)).toEqual(['Entry', 'NamedEntry', 'present'])
			expect(() => readConformanceExports([join(scratch.path, 'absent.ts')])).toThrow(
				'Missing export module:',
			)
		} finally {
			scratch.destroy()
		}
	})

	it('reads declaration forms and defaults, strips comments, and terminates star cycles', () => {
		const scratch = createScratch({ parent: 'tmp', prefix: 'u17-export-forms-' })
		try {
			const path = scratch.write(
				'index.ts',
				[
					"export * from './index.js'",
					'// export class ModelContextComment {}',
					'/* export { Hidden as WebMCPComment } */',
					'export declare abstract class AbstractEntry {}',
					'export function call() {}',
					'export const fixed = "https://example.test"',
					'export let changing = 1',
					'export var legacy = 1',
					'export interface Entry {}',
					'export type Alias = Entry',
					'export enum Choice {}',
					'export namespace Space {}',
					'export { call, Entry as RenamedEntry }',
					'export // comment between keywords',
					' class AcrossLine {}',
					'export default fixed',
				].join('\n'),
			)
			expect(readConformanceExports([path]).get(path)).toEqual([
				'AbstractEntry',
				'AcrossLine',
				'Alias',
				'Choice',
				'Entry',
				'RenamedEntry',
				'Space',
				'call',
				'changing',
				'default',
				'fixed',
				'legacy',
			])
			scratch.write('external.ts', "export * from 'unowned-package'\n")
			expect(() => readConformanceExports([join(scratch.path, 'external.ts')])).toThrow(
				'Nonrelative star export: unowned-package',
			)
		} finally {
			scratch.destroy()
		}
	})

	it('reads the adopted model from the operation input', async () => {
		const row = requireValue(WEBMCP_MAPPING_ROWS[0])
		expect(await readAdoptionModel(row.input)).toEqual(row.expected)
	})

	it('reads the skip model independently of the expected reason', async () => {
		const row = requireValue(WEBMCP_SKIP_ROWS.find((entry) => entry.symbol === 'debug'))
		expect(await readSkipModel(row.input)).toEqual(row.expected)
	})

	it('requires the supplied WPT revision listing and both directories with their entry counts', () => {
		const row = requireValue(
			WEBMCP_GAPS.find((entry) => entry.symbol.startsWith('WPT directory provenance')),
		)
		expect(existsSync(WEBMCP_WPT_LISTING_PATH)).toBe(true)
		expect(row.model).toEqual({ revision: true, entries: 88, imperative: 55, declarative: 28 })
		expect(WEBMCP_WPT_ENTRIES).toContain(
			'webmcp/imperative/register_tool_name_validation.https.html',
		)
		expect(WEBMCP_WPT_ENTRIES).toContain('webmcp/declarative/executeTool-no-autosubmit.https.html')
	})
})
