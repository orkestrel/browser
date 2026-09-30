import { createHash } from 'node:crypto'
import type { BrowserToolsetReason } from '@src/core'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { isRecord, isString } from '@orkestrel/contract'
import { createRecorder, requireValue, waitForCondition } from '@orkestrel/test'
import {
	createBrowserToolset,
	parseBrowserTool,
	parseBrowserRemoval,
	parseBrowserInvocation,
	parseBrowserInvocationResult,
} from '@src/core'
import { ModelContextRegistry } from './fixtures/modelContext.js'
import { createBrowserElementFixture, replyOk } from './setup.js'

/** Records a ruled comparison between a package reading and its pinned authority. */
export interface ConformanceRow {
	readonly symbol: string
	readonly expected: unknown
	readonly model: unknown
	readonly ruling: 'implement' | 'retain' | 'exclude'
	readonly closer?: string
}

/** Defers a ruled model reading until its independent wire input reaches the real operation. */
export interface ConformanceOperationRow extends ConformanceRow {
	readonly input: Readonly<Record<string, unknown>>
	readonly model: (input: Readonly<Record<string, unknown>>) => Promise<unknown>
}

/** Enumerates source declarations and export clauses reachable through local star exports.
 * @param paths - Entry modules, including barrels or scratch controls
 * @returns Exported names by entry path
 * @throws Thrown when a module cannot be read or a star export is not relative.
 */
export function readConformanceExports(
	paths: readonly string[],
): ReadonlyMap<string, readonly string[]> {
	const exports = new Map<string, readonly string[]>()
	for (const path of paths) {
		const pending = [resolve(path)]
		const visited = new Set<string>()
		const names = new Set<string>()
		while (pending.length > 0) {
			const module = requireValue(pending.pop())
			if (visited.has(module)) continue
			visited.add(module)
			if (!existsSync(module)) throw new Error(`Missing export module: ${module}`)
			// Preserve quoted text while removing block and line comments, including between keywords.
			const source = readFileSync(module, 'utf8').replace(
				/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
				(token) => (token.startsWith('/') ? ' ' : token),
			)
			for (const match of source.matchAll(
				/\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|function|const|let|var|interface|type|enum|namespace)\s+([$\w]+)/g,
			))
				names.add(requireValue(match[1]))
			for (const match of source.matchAll(/\bexport\s+(?:type\s+)?\{([^}]+)\}/g)) {
				for (const entry of requireValue(match[1]).split(',')) {
					const name = /^(?:type\s+)?([$\w]+)(?:\s+as\s+([$\w]+))?$/.exec(entry.trim())
					if (name !== null) names.add(requireValue(name[2] ?? name[1]))
				}
			}
			if (/\bexport\s+default\b/.test(source)) names.add('default')
			for (const match of source.matchAll(/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
				const target = requireValue(match[1])
				if (!target.startsWith('.')) throw new Error(`Nonrelative star export: ${target}`)
				pending.push(resolve(dirname(module), target.replace(/\.js$/, '.ts')))
			}
		}
		exports.set(path, [...names].sort())
	}
	return exports
}

/** Supplies a star-export chain ending in indirect and comment-separated forbidden exports. */
export const WEBMCP_EXPORT_CONTROL = Object.freeze({
	'index.ts': "export * from './bridge.js'\n",
	'bridge.ts': "export * from './definitions.js'\n",
	'definitions.ts':
		'export class BrowserRegistry {}\nexport { BrowserRegistry as BrowserModelContext }\nexport /* note */ class ModelContextThing {}\n',
})

/** Locates the Orchestrator's revision-specific WPT tree listing. */
export const WEBMCP_WPT_LISTING_PATH = fileURLToPath(
	new URL('./mirrors/wpt-webmcp-e6ba3d7abea7.txt', import.meta.url),
)
/** Holds the supplied git tree listing, whose presence the setup proof requires. */
export const WEBMCP_WPT_LISTING = readFileSync(WEBMCP_WPT_LISTING_PATH, 'utf8')
/** Records each listed WPT path, excluding the provenance header. */
export const WEBMCP_WPT_ENTRIES: readonly string[] = Object.freeze(
	[...WEBMCP_WPT_LISTING.matchAll(/\t(webmcp\/[^\r\n]+)$/gm)].flatMap((match) =>
		match[1] === undefined ? [] : [match[1]],
	),
)

/** Reads the real registry's adoption and its retained protocol annotation.
 * @param input - Mirror-shaped tool delivered over the protocol boundary
 * @returns Adopted annotations and the retained autosubmit value
 */
export async function readAdoptionModel(
	input: Readonly<Record<string, unknown>>,
): Promise<unknown> {
	const fixture = await createBrowserElementFixture({
		registry: (message) => fixture.transport.reply(message.id, {}),
	})
	try {
		await fixture.page.registry.start()
		fixture.transport.event('WebMCP.toolsAdded', { tools: [input] }, 'session-main')
		const adopted = requireValue((await fixture.page.registry.adopt())[0])
		const autosubmit = fixture.page.registry.tools()[0]?.annotation.autosubmit
		return { annotations: adopted.annotations, ...(autosubmit === undefined ? {} : { autosubmit }) }
	} finally {
		await fixture.client.close()
	}
}

/** Reads the real toolset's exclusion and whether the excluded tool was installed.
 * @param input - Mirror-shaped tool delivered over the protocol boundary
 * @returns The emitted name and reason with the tool's membership
 */
export async function readSkipModel(input: Readonly<Record<string, unknown>>): Promise<unknown> {
	const fixture = await createBrowserElementFixture({
		registry: (message) => fixture.transport.reply(message.id, {}),
	})
	const toolset = createBrowserToolset(fixture.page)
	try {
		replyOk(fixture.transport, 'WebMCP.disable')
		const skips = createRecorder<readonly [string, BrowserToolsetReason]>()
		toolset.emitter.on('skip', skips.handler)
		await toolset.start()
		fixture.transport.event('WebMCP.toolsAdded', { tools: [input] }, 'session-main')
		await waitForCondition('skip reported', () => skips.count > 0)
		const [name, reason] = requireValue(skips.calls[0])
		return { name, reason, present: toolset.tools.tool(name) !== undefined }
	} finally {
		await toolset.destroy()
		await fixture.client.close()
	}
}

/** Pins the specification source bytes. */
export const WEBMCP_INDEX_DIGEST =
	'e6c9b9790fd5cabc11662bbfeb296a6919388d8fd3f23bf7c85258059948b1b9'
/** Pins the webref IDL bytes. */
export const WEBMCP_WEBREF_DIGEST =
	'eddabc7932e9fdfe5e7c48efffb6fe4606657c5f45c9799038d361775802f332'
/** Pins the raw protocol domain cut. */
export const WEBMCP_DOMAIN_DIGEST =
	'13fb565428f1fc1e09bca51b1234536c5c8da77adf0bd952700e6cdbbc4f1bf6'
/** Pins the whole protocol file from which the domain was cut, without vendoring it. */
export const WEBMCP_PROTOCOL_DIGEST =
	'672d8481c92832907211e85488e216cd5b1a922fde273faff72f7f6cf765899e'
/** Records the domain byte range, with an exclusive end. */
export const WEBMCP_DOMAIN_RANGE = Object.freeze({ start: 1404474, end: 1415819 })
/** Locates the revision-named source mirror. */
export const WEBMCP_INDEX_PATH = fileURLToPath(
	new URL('./mirrors/webmcp-index-19fc56516057.bs', import.meta.url),
)
/** Locates the revision-named IDL mirror. */
export const WEBMCP_WEBREF_PATH = fileURLToPath(
	new URL('./mirrors/webmcp-webref-e6ba3d7abea7.idl', import.meta.url),
)
/** Locates the revision-named domain mirror. */
export const WEBMCP_DOMAIN_PATH = fileURLToPath(
	new URL('./mirrors/webmcp-domain-dc2ddf369035.json', import.meta.url),
)

/** Formats a drift with the authority's expected value.
 * @param symbol - Compared symbol
 * @param authority - Pinned authority
 * @param value - Authority value
 * @returns The failure description
 */
export function formatConformanceDrift(symbol: string, authority: string, value: unknown): string {
	return `${symbol} drifted; ${authority}=${JSON.stringify(value)}`
}

/** Reports unequal readings, comparing composite values without depending on property order.
 * @param symbol - Compared symbol
 * @param local - Local reading
 * @param authority - Pinned authority
 * @param value - Authority reading
 * @returns A drift description, or undefined on equality
 */
export function readConformanceDrift(
	symbol: string,
	local: unknown,
	authority: string,
	value: unknown,
): string | undefined {
	return isDeepStrictEqual(local, value)
		? undefined
		: formatConformanceDrift(symbol, authority, value)
}

/** Reads raw bytes only after their digest matches the pin.
 * @param path - Mirror path
 * @param digest - Expected SHA-256 digest
 * @returns The verified bytes
 * @throws Thrown when the digest differs or the file cannot be read.
 */
export function readMirror(path: string, digest: string): Uint8Array {
	const bytes = readFileSync(path)
	if (createHash('sha256').update(bytes).digest('hex') !== digest)
		throw new Error(formatConformanceDrift(`${basename(path)} bytes`, 'SHA-256', digest))
	return bytes
}

/** Holds the verified specification source. */
export const WEBMCP_INDEX = readMirror(WEBMCP_INDEX_PATH, WEBMCP_INDEX_DIGEST)
/** Holds the verified webref IDL. */
export const WEBMCP_WEBREF = readMirror(WEBMCP_WEBREF_PATH, WEBMCP_WEBREF_DIGEST)
/** Holds the verified raw domain cut. */
export const WEBMCP_DOMAIN = readMirror(WEBMCP_DOMAIN_PATH, WEBMCP_DOMAIN_DIGEST)

/** Decodes verified mirror bytes without rewriting them.
 * @param bytes - Verified bytes
 * @returns UTF-8 text
 */
export function readMirrorText(bytes: Uint8Array): string {
	return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/** Reads an IDL declaration block from a pinned text mirror.
 * @param text - Mirror text
 * @param name - Interface or dictionary name
 * @returns The declaration body
 * @throws Thrown when the declaration is absent.
 */
export function readIDLBlock(text: string, name: string): string {
	const body = new RegExp(
		`(?:interface|dictionary) ${name}(?: : \\w+)? \\{([\\s\\S]*?)\\n\\};`,
	).exec(text)?.[1]
	if (body === undefined) throw new Error(`Missing IDL block: ${name}`)
	return body
}

/** Reads named records from one protocol collection.
 * @param root - Protocol object
 * @param key - Collection key
 * @returns Records in mirror order
 * @throws Thrown when the collection is malformed.
 */
export function readDomainRecords(
	root: unknown,
	key: string,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
	const values = isRecord(root) ? root[key] : undefined
	if (!Array.isArray(values) || !values.every(isRecord))
		throw new Error(`Missing protocol collection: ${key}`)
	return values
}

/** Finds a protocol record by its external name or id.
 * @param records - Protocol records
 * @param name - External name
 * @returns The record
 * @throws Thrown when absent.
 */
export function readDomainRecord(
	records: ReadonlyArray<Readonly<Record<string, unknown>>>,
	name: string,
): Readonly<Record<string, unknown>> {
	const record = records.find((entry) => entry['name'] === name || entry['id'] === name)
	if (record === undefined) throw new Error(`Missing protocol record: ${name}`)
	return record
}

/** Records property reads made by the real parser against a valid protocol value.
 * @param parser - Production parser
 * @param value - Valid protocol fixture
 * @returns Sorted external property names read by the parser
 */
export function readParserFields(
	parser: (value: unknown) => unknown,
	value: Readonly<Record<string, unknown>>,
): readonly string[] {
	const names = new Set<string>()
	parser(
		new Proxy(value, {
			get(target, key) {
				if (typeof key === 'string') names.add(key)
				return Reflect.get(target, key)
			},
		}),
	)
	return [...names].sort()
}

/** Holds a mirror-shaped tool with every optional coordinate populated. */
export const WEBMCP_TOOL = Object.freeze({
	name: 'search-cars',
	description: 'Search cars',
	frameId: 'main',
	backendNodeId: 50,
	inputSchema: { type: 'object', properties: { what: { type: 'string' } }, required: ['what'] },
	annotations: {
		readOnly: true,
		untrustedContent: false,
		consequential: true,
		debugging: false,
		autosubmit: true,
	},
	stackTrace: { callFrames: [] },
})
/** Holds the parsed domain authority. */
export const WEBMCP_PROTOCOL: unknown = JSON.parse(readMirrorText(WEBMCP_DOMAIN))
/** Holds the external tool fields the parser reads. */
export const WEBMCP_TOOL_FIELDS = readParserFields(parseBrowserTool, WEBMCP_TOOL)
/** Holds the external annotation fields the parser reads. */
export const WEBMCP_ANNOTATION_FIELDS = readParserFields(
	(annotations) => parseBrowserTool({ ...WEBMCP_TOOL, annotations }),
	WEBMCP_TOOL.annotations,
)
/** Holds the external removal fields the parser reads. */
export const WEBMCP_REMOVAL_FIELDS = readParserFields(parseBrowserRemoval, {
	name: 'search-cars',
	frameId: 'main',
})
/** Holds the external invocation fields the parser reads. */
export const WEBMCP_INVOCATION_FIELDS = readParserFields(parseBrowserInvocation, {
	invocationId: 'call',
	toolName: 'search-cars',
	frameId: 'main',
	input: '{}',
})
/** Holds the external result fields the parser reads, including its exception fallback. */
export const WEBMCP_RESULT_FIELDS = readParserFields(parseBrowserInvocationResult, {
	invocationId: 'call',
	status: 'Completed',
	output: 'cars',
	errorText: undefined,
	exception: { description: 'failure' },
})

/** Builds field rows from every property in a protocol type, retaining explicit exclusions.
 * @param name - Protocol type
 * @param fields - Fields the production parser read
 * @returns Ruled property comparisons
 */
export function buildDomainRows(
	name: string,
	fields: readonly string[],
): readonly ConformanceRow[] {
	return readDomainRecords(
		readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'types'), name),
		'properties',
	).map((property): ConformanceRow => {
		const key = property['name']
		if (!isString(key)) throw new Error('Protocol property has no name')
		return key === 'stackTrace'
			? {
					symbol: `${name}.${key}`,
					expected: false,
					model: fields.includes(key),
					ruling: 'exclude',
					closer:
						'A developer diagnostics consumer; stackTrace is a developer datum excluded from the agent surface.',
				}
			: {
					symbol: `${name}.${key}`,
					expected: true,
					model: fields.includes(key),
					ruling: 'implement',
				}
	})
}

/** Rules every domain property against production parser reads. */
export const WEBMCP_DOMAIN_ROWS: readonly ConformanceRow[] = Object.freeze([
	...buildDomainRows('Tool', WEBMCP_TOOL_FIELDS),
	...buildDomainRows('Annotation', WEBMCP_ANNOTATION_FIELDS),
	...buildDomainRows('RemovedTool', WEBMCP_REMOVAL_FIELDS),
	...['enable', 'disable', 'invokeTool', 'cancelInvocation'].map((name): ConformanceRow => ({
		symbol: `command.${name}`,
		expected: name,
		model: readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'commands'), name)['name'],
		ruling: 'implement',
	})),
	...['toolsAdded', 'toolsRemoved', 'toolInvoked', 'toolResponded'].map((name): ConformanceRow => ({
		symbol: `event.${name}`,
		expected: name,
		model: readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'events'), name)['name'],
		ruling: 'implement',
	})),
	{
		symbol: 'InvocationStatus',
		expected: ['Completed', 'Canceled', 'Error'],
		model: readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'types'), 'InvocationStatus')[
			'enum'
		],
		ruling: 'implement',
	},
	{
		symbol: 'invokeTool.invocationId ordering',
		expected: true,
		model: String(
			readDomainRecord(
				readDomainRecords(
					readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'commands'), 'invokeTool'),
					'returns',
				),
				'invocationId',
			)['description'],
		).includes('Response is sent before tool events.'),
		ruling: 'implement',
	},
	{
		symbol: 'toolResponded.output trust',
		expected: true,
		model: /untrusted/i.test(
			String(
				readDomainRecord(
					readDomainRecords(
						readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'events'), 'toolResponded'),
						'parameters',
					),
					'output',
				)['description'],
			),
		),
		ruling: 'implement',
	},
])

/** Holds source text decoded from verified bytes. */
export const WEBMCP_SOURCE = readMirrorText(WEBMCP_INDEX)
/** Holds IDL text decoded from verified bytes. */
export const WEBMCP_IDL = readMirrorText(WEBMCP_WEBREF)
/** Rules the specification's interface and annotation members. */
export const WEBMCP_SOURCE_ROWS: readonly ConformanceRow[] = Object.freeze([
	...[
		'registerTool',
		'getTools',
		'executeTool',
		'ontoolchange',
		'ontoolactivated',
		'ontoolcancel',
	].map((name): ConformanceRow => ({
		symbol: `index.ModelContext.${name}`,
		expected: true,
		model: readIDLBlock(WEBMCP_SOURCE, 'ModelContext').includes(name),
		ruling: 'implement',
	})),
	...['readOnlyHint', 'untrustedContentHint', 'consequentialHint', 'debugging'].map(
		(name): ConformanceRow => ({
			symbol: `index.ToolAnnotations.${name}`,
			expected: true,
			model: readIDLBlock(WEBMCP_SOURCE, 'ToolAnnotations').includes(`boolean ${name} = false;`),
			ruling: 'implement',
		}),
	),
	{
		symbol: 'index.executeTool return',
		expected: true,
		model: readIDLBlock(WEBMCP_SOURCE, 'ModelContext').includes('Promise<DOMString> executeTool('),
		ruling: 'implement',
	},
	{
		symbol: 'index.name validation',
		expected: true,
		model:
			/between 1 and 128, inclusive,[\s\S]*?ASCII alphanumeric[\s\S]*?code points[\s\S]*?U\+005F LOW LINE \(_\),\s*U\+002D HYPHEN-MINUS \(-\), and U\+002E FULL STOP \(\.\)/.test(
				WEBMCP_SOURCE,
			),
		ruling: 'implement',
	},
	{
		symbol: 'index.test suite',
		expected: true,
		model: /^Test Suite: https:\/\/wpt.fyi\/results\/webmcp$/m.test(WEBMCP_SOURCE),
		ruling: 'implement',
	},
	{
		symbol: 'BrowserToolAnnotation.autosubmit retained beyond source ToolAnnotations',
		expected: true,
		model:
			parseBrowserTool(WEBMCP_TOOL)?.annotation.autosubmit === true &&
			!readIDLBlock(WEBMCP_SOURCE, 'ToolAnnotations').includes('autosubmit'),
		ruling: 'retain',
		closer:
			'Retains the protocol annotation while the specification has no autosubmit hint; it emits no outline mark.',
	},
])
/** Rules webref's older interface against the package double. */
export const WEBMCP_WEBREF_ROWS: readonly ConformanceRow[] = Object.freeze([
	{
		symbol: 'webref.handlers',
		expected: ['ontoolchange'],
		model: [
			...readIDLBlock(WEBMCP_IDL, 'ModelContext').matchAll(/attribute EventHandler (\w+);/g),
		].map((match) => match[1]),
		ruling: 'implement',
	},
	{
		symbol: 'webref.hints',
		expected: ['readOnlyHint', 'untrustedContentHint', 'consequentialHint'],
		model: [...readIDLBlock(WEBMCP_IDL, 'ToolAnnotations').matchAll(/boolean (\w+)/g)].map(
			(match) => match[1],
		),
		ruling: 'implement',
	},
	...[
		...readIDLBlock(WEBMCP_IDL, 'ModelContext').matchAll(
			/\b(\w+)\(|attribute EventHandler (\w+);/g,
		),
	].map((match): ConformanceRow => ({
		symbol: `double.${match[1] ?? match[2]}`,
		expected: true,
		model: (match[1] ?? match[2] ?? '') in ModelContextRegistry.prototype,
		ruling: 'implement',
	})),
	...['ontoolactivated', 'ontoolcancel'].map((name): ConformanceRow => ({
		symbol: `double.${name} ahead of webref`,
		expected: true,
		model:
			name in ModelContextRegistry.prototype &&
			!readIDLBlock(WEBMCP_IDL, 'ModelContext').includes(name),
		ruling: 'retain',
		closer: 'Retains the specification source member while webref catches up.',
	})),
])
/** Records bounded gaps and the authority readings that support them. */
export const WEBMCP_GAPS: readonly ConformanceRow[] = Object.freeze([
	{
		symbol:
			'WPT cases remain outside the double: tests/mirrors/wpt-webmcp-e6ba3d7abea7.txt at e6ba3d7abea7 lists 88 entries, including 55 under webmcp/imperative/ and 28 under webmcp/declarative/',
		expected: false,
		model: globSync('tests/**/webmcp/{imperative,declarative}/**/*.{js,html}').length > 0,
		ruling: 'exclude',
		closer:
			'A testharness runner under the Playwright provider must run these cases against the double.',
	},
	{
		symbol:
			'WPT directory provenance from tests/mirrors/wpt-webmcp-e6ba3d7abea7.txt at e6ba3d7abea7',
		expected: { revision: true, entries: 88, imperative: 55, declarative: 28 },
		model: {
			revision: WEBMCP_WPT_LISTING.startsWith(
				'# wpt webmcp/ tree at e6ba3d7abea784a1f03347bccaad76e7a6347eae ',
			),
			entries: WEBMCP_WPT_ENTRIES.length,
			imperative: WEBMCP_WPT_ENTRIES.filter((path) => path.startsWith('webmcp/imperative/')).length,
			declarative: WEBMCP_WPT_ENTRIES.filter((path) => path.startsWith('webmcp/declarative/'))
				.length,
		},
		ruling: 'implement',
	},
	{
		symbol:
			'name charset and bound: provider ASCII alphanumerics _ - / 64; specification adds . / 128',
		expected: true,
		model:
			WEBMCP_SOURCE.includes('between 1 and 128, inclusive') &&
			WEBMCP_SOURCE.includes('U+002E FULL STOP (.)'),
		ruling: 'retain',
		closer:
			'Retains the provider charset and 64 bound documented beside BROWSER_TOOL_NAME_PATTERN in src/core/constants.ts. PROPOSAL.md decision 27 governs digest-pinned conformance and its refresh ritual only.',
	},
	{
		symbol: 'declarative toolname, tooldescription, toolautosubmit ahead of source',
		expected: true,
		model:
			/<h3 id="declarative-api">[\s\S]*?This section is entirely a TODO/.test(WEBMCP_SOURCE) &&
			!/toolname|tooldescription|toolautosubmit/.test(WEBMCP_SOURCE),
		ruling: 'retain',
		closer: 'The specification declarative section; the mark follows the Chrome explainer.',
	},
	{
		symbol: 'webref lag: ontoolchange alone and three hints',
		expected: false,
		model:
			/ontoolactivated|ontoolcancel/.test(readIDLBlock(WEBMCP_IDL, 'ModelContext')) ||
			/debugging/.test(readIDLBlock(WEBMCP_IDL, 'ToolAnnotations')),
		ruling: 'exclude',
		closer: 'A webref extraction carrying the source handlers and debugging annotation.',
	},
])

/** Rules every terminal status the registry must settle. */
export const WEBMCP_STATUS_ROWS: readonly ConformanceRow[] = Object.freeze(
	['Completed', 'Canceled', 'Error'].map((symbol): ConformanceRow => ({
		symbol,
		expected: true,
		model:
			Array.isArray(
				readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'types'), 'InvocationStatus')['enum'],
			) &&
			String(
				readDomainRecord(readDomainRecords(WEBMCP_PROTOCOL, 'types'), 'InvocationStatus')['enum'],
			)
				.split(',')
				.includes(symbol),
		ruling: 'implement',
	})),
)
/** Rules annotations projected by the real registry adoption. */
export const WEBMCP_MAPPING_ROWS: readonly ConformanceOperationRow[] = Object.freeze([
	{
		symbol: 'readOnly false, consequential true, untrustedContent false',
		input: {
			...WEBMCP_TOOL,
			annotations: { readOnly: false, consequential: true, untrustedContent: false },
		},
		expected: { annotations: { pure: false, consequential: true, untrusted: true } },
		model: readAdoptionModel,
		ruling: 'retain',
		closer:
			'Retains the package trust boundary: every page tool is untrusted, regardless of its hint.',
	},
	{
		symbol: 'readOnly true, consequential false, untrustedContent true',
		input: {
			...WEBMCP_TOOL,
			annotations: { readOnly: true, consequential: false, untrustedContent: true },
		},
		expected: { annotations: { pure: true, consequential: false, untrusted: true } },
		model: readAdoptionModel,
		ruling: 'retain',
		closer:
			'Retains the package trust boundary: every page tool is untrusted, regardless of its hint.',
	},
	{
		symbol: 'omitted annotations',
		input: { name: 'search-cars', description: 'Search cars', frameId: 'main' },
		expected: { annotations: { untrusted: true } },
		model: readAdoptionModel,
		ruling: 'retain',
		closer:
			'Retains untrusted when the page supplies no annotations; absent behavioral hints stay absent.',
	},
	{
		symbol: 'omitted behavioral hints with untrustedContent true',
		input: { ...WEBMCP_TOOL, annotations: { untrustedContent: true } },
		expected: { annotations: { untrusted: true } },
		model: readAdoptionModel,
		ruling: 'retain',
		closer: 'Retains untrusted without inventing pure or consequential hints.',
	},
	{
		symbol: 'omitted behavioral hints with untrustedContent false',
		input: { ...WEBMCP_TOOL, annotations: { untrustedContent: false } },
		expected: { annotations: { untrusted: true } },
		model: readAdoptionModel,
		ruling: 'retain',
		closer: 'Retains untrusted without inventing pure or consequential hints.',
	},
	{
		symbol: 'autosubmit retained on the protocol tool without an adopted hint',
		input: { ...WEBMCP_TOOL, annotations: { autosubmit: true } },
		expected: { annotations: { untrusted: true }, autosubmit: true },
		model: readAdoptionModel,
		ruling: 'retain',
		closer:
			'Retains the protocol annotation on BrowserToolAnnotation without a tool hint or outline mark.',
	},
])
/** Rules tools excluded at the provider and debugging boundaries. */
export const WEBMCP_SKIP_ROWS: readonly ConformanceOperationRow[] = Object.freeze([
	{
		symbol: 'a.b',
		input: { ...WEBMCP_TOOL, name: 'a.b', annotations: {} },
		expected: { name: 'a.b', reason: 'pattern', present: false },
		model: readSkipModel,
		ruling: 'exclude',
		closer:
			'Retains the provider charset documented beside BROWSER_TOOL_NAME_PATTERN in src/core/constants.ts.',
	},
	{
		symbol: 'a'.repeat(65),
		input: { ...WEBMCP_TOOL, name: 'a'.repeat(65), annotations: {} },
		expected: { name: 'a'.repeat(65), reason: 'pattern', present: false },
		model: readSkipModel,
		ruling: 'exclude',
		closer:
			'Retains the provider 64-character bound documented beside BROWSER_TOOL_NAME_PATTERN in src/core/constants.ts.',
	},
	{
		symbol: 'debug',
		input: { ...WEBMCP_TOOL, name: 'debug', annotations: { debugging: true } },
		expected: { name: 'debug', reason: 'debugging', present: false },
		model: readSkipModel,
		ruling: 'exclude',
		closer: 'Explicit developer-tool opt-in, outside the agent toolset.',
	},
])
