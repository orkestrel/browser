/**
 * Readiness setup for the `service` project.
 *
 * The live service this package drives is a real Chromium-family browser installed on
 * the host. Readiness is hard-required rather than skipped: every proof under
 * `tests/service/` resolves its browser through `requireSystemBrowser`, which throws a
 * named error naming what to install when the host has none, so a browserless machine
 * fails the project loudly instead of reporting a green run over proofs that never
 * executed. `tests/setupService.test.ts` pins that contract over the whole directory.
 *
 * Readiness resolves on call rather than at module load, so this module stays importable
 * by its own proof in the `setup` project, which `npm test` runs on any host.
 */

import type { BrowserEngine, SystemBrowser, SystemBrowserOptions } from '@src/server'
import { findSystemBrowser } from '@src/server'
import { isArray, isRecord, isString } from '@orkestrel/contract'

/**
 * Lists the container-safe launch flags every live-browser proof shares.
 *
 * @remarks
 * Headless Chromium running as root — the common case in a sandboxed container — needs
 * sandboxing off because it requires a non-root user, needs `/dev/shm` bypassed because
 * it is usually too small, and needs the GPU off because none is reachable.
 */
export const SERVICE_BROWSER_ARGS: readonly string[] = Object.freeze([
	'--no-sandbox',
	'--disable-dev-shm-usage',
	'--disable-gpu',
])

/** Names the environment variable narrowing service discovery to one browser engine. */
export const SERVICE_ENGINE_ENV_KEY = 'BROWSER_COMPATIBILITY_ENGINE'

/**
 * Resolves the engine service discovery narrows to, from a requested value.
 *
 * @param value - The requested engine name, normally read from `SERVICE_ENGINE_ENV_KEY`
 * @returns The engine when the value names a supported one; `undefined` otherwise, which
 * leaves discovery open to every engine
 */
export function resolveServiceEngine(value: string | undefined): BrowserEngine | undefined {
	return value === 'chromium' || value === 'chrome' || value === 'edge' ? value : undefined
}

/**
 * Resolves the live browser a service proof drives, or throws naming what to install.
 *
 * @param options - Candidate-source overrides; discovery narrows to the engine
 * `SERVICE_ENGINE_ENV_KEY` names when absent
 * @returns The discovered {@link SystemBrowser}
 * @throws Thrown when no candidate source resolves a browser executable.
 */
export function requireSystemBrowser(options?: SystemBrowserOptions): SystemBrowser {
	const engine = resolveServiceEngine(process.env[SERVICE_ENGINE_ENV_KEY])
	const found = findSystemBrowser(options ?? (engine === undefined ? undefined : { engine }))
	if (found === undefined) {
		throw new Error(
			'The service project requires a Chromium-family browser on this host and found none. ' +
				'Install one, or point PLAYWRIGHT_EXECUTABLE_PATH or CHROME_PATH at an executable.',
		)
	}
	return found
}

/**
 * Cites the protocol reading that makes the live `WebMCP` mirror inapplicable on a host.
 *
 * @remarks
 * A service proof passes it to a conditional skip after asserting the reading it names, so the
 * skip reports the mechanism rather than the browser's name.
 */
export const REGISTRY_ABSENT_REASON =
	'WebMCP.enable answers CDP error -32601 (method not found) and Schema.getDomains lists no WebMCP domain, so this browser has no page registry to mirror'

/**
 * Parses the domain names a `Schema.getDomains` reply lists.
 *
 * @param reply - The raw `Schema.getDomains` result
 * @returns The domain names in reply order; `undefined` when the reply carries no `domains`
 * list or a listed domain has no string `name`
 */
export function parseProtocolDomains(reply: unknown): readonly string[] | undefined {
	if (!isRecord(reply) || !isArray(reply['domains'])) return undefined
	const names: string[] = []
	for (const domain of reply['domains']) {
		if (!isRecord(domain) || !isString(domain['name'])) return undefined
		names.push(domain['name'])
	}
	return names
}

/**
 * Extracts the reference numbers an outline's element rows carry, in row order.
 *
 * @param text - The `text` of a `BrowserOutline`
 * @returns The number after the `e` of each row that opens with a reference such as `e12`;
 * heading, text, and summary rows contribute nothing
 */
export function extractOutlineReferences(text: string): readonly number[] {
	return [...text.matchAll(/^e([1-9]\d*) /gm)].map((match) => Number(match[1]))
}

/**
 * Lists the launch flags that expose the `WebMCP` protocol domain on a Chrome that ships it behind
 * a feature switch.
 *
 * @remarks
 * A Chromium without the domain ignores the switch, and `WebMCP.enable` still answers `-32601`.
 */
export const SERVICE_REGISTRY_ARGS: readonly string[] = Object.freeze(['--enable-features=WebMCP'])

const SKIP_LITERALS: ReadonlySet<string> = new Set([
	'true',
	'false',
	'null',
	'undefined',
	'NaN',
	'Infinity',
])

/**
 * Scans a service proof's source for every skip it declares and returns each one that is not a
 * conditional context skip with a cited reason.
 *
 * @param source - The proof's source text
 * @param reasons - The names of the exported reason constants a skip may cite
 * @returns The offending skip texts in source order; empty when the only skips read
 * `context.skip(!CONDITION, REASON)`, where `CONDITION` is an identifier, a member path, or a
 * call rather than a literal, and `REASON` is one of `reasons`
 * @remarks Every `.skip`, `.skipIf`, and `.runIf` on any receiver counts, so a chained
 * declaration such as `it.skip.each`, `describe.skip`, `test.skip`, or `it.skipIf` is an
 * offence however it is called.
 */
export function scanServiceSkips(source: string, reasons: readonly string[]): readonly string[] {
	const findings: string[] = []
	for (const match of source.matchAll(/([A-Za-z_$][\w$]*)\s*\.\s*(skip|skipIf|runIf)\b/g)) {
		const [declaration, receiver, member] = match
		let cursor = match.index + declaration.length
		while (/\s/.test(source.charAt(cursor))) cursor += 1
		if (receiver !== 'context' || member !== 'skip' || source.charAt(cursor) !== '(') {
			findings.push(source.slice(match.index).split('\n', 1)[0] ?? declaration)
			continue
		}
		const parts: string[] = ['']
		let depth = 0
		for (cursor += 1; cursor < source.length; cursor += 1) {
			const character = source.charAt(cursor)
			if (character === ')' && depth === 0) break
			if (character === '(' || character === '[' || character === '{') depth += 1
			if (character === ')' || character === ']' || character === '}') depth -= 1
			if (character === ',' && depth === 0) parts.push('')
			else parts[parts.length - 1] += character
		}
		const [condition, reason, ...rest] = parts.map((part) => part.trim())
		const subject = /^!\s*([A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)*(?:\(.*\))?$/s.exec(
			condition ?? '',
		)?.[1]
		if (
			subject === undefined ||
			SKIP_LITERALS.has(subject) ||
			reason === undefined ||
			!reasons.includes(reason) ||
			rest.length > 0
		)
			findings.push(source.slice(match.index).split('\n', 1)[0] ?? declaration)
	}
	return findings
}

/**
 * Checks that a history navigation was served from the back-forward cache, and names the host's
 * reasons when it was not.
 *
 * @param navigations - The `Page.frameNavigated` parameters recorded for the navigation
 * @param misses - The `Page.backForwardCacheNotUsed` parameters recorded for the navigation
 * @throws Thrown when the host reported a cache miss, naming each `notRestoredExplanations`
 * reason and the remedy, or when no navigation of type `BackForwardCacheRestore` was recorded.
 */
export function requireCacheRestore(
	navigations: readonly unknown[],
	misses: readonly unknown[],
): void {
	if (misses.length > 0) {
		const reasons = misses.flatMap((miss) =>
			isRecord(miss) && isArray(miss['notRestoredExplanations'])
				? miss['notRestoredExplanations'].map((explanation) =>
						isRecord(explanation) && isString(explanation['reason'])
							? explanation['reason']
							: 'unnamed',
					)
				: ['unnamed'],
		)
		throw new Error(
			`Precondition failed: the host did not restore the page from the back-forward cache (${reasons.join(', ')}); run the service project with fewer concurrent browsers.`,
		)
	}
	if (
		!navigations.some(
			(navigation) => isRecord(navigation) && navigation['type'] === 'BackForwardCacheRestore',
		)
	)
		throw new Error(
			'Precondition failed: the history navigation committed without a back-forward cache restore and without a reported cache miss.',
		)
}

/** Describes one element row of a rendered outline: its reference, its role, and its name. */
export interface ServiceOutlineRow {
	readonly reference: string
	readonly role: string
	readonly name: string
}

/**
 * Extracts the element rows of a rendered outline, in row order.
 *
 * @param text - The `text` of a `BrowserOutline`, or a toolset receipt that carries one
 * @returns The reference, role, and JSON-decoded name of each row that opens with a reference
 * such as `e12` followed by a role and a quoted name; heading, text, and summary rows contribute
 * nothing
 */
export function extractOutlineRows(text: string): readonly ServiceOutlineRow[] {
	return [...text.matchAll(/^(e[1-9]\d*) (\S+) ("(?:[^"\\\n]|\\.)*")/gm)].flatMap((match) => {
		const [, reference, role, quoted] = match
		const name: unknown = JSON.parse(quoted ?? '""')
		return reference === undefined || role === undefined || !isString(name)
			? []
			: [{ reference, role, name }]
	})
}

/**
 * Collects the role and name of every element row of a rendered outline, as a sorted list.
 *
 * @param text - The `text` of a `BrowserOutline`, or a toolset receipt that carries one
 * @returns One `ROLE "NAME"` entry per element row, with the name JSON-quoted, sorted by code
 * unit so two outlines that list the same elements in different orders or under different
 * references collect equal lists
 */
export function collectOutlinePairs(text: string): readonly string[] {
	return extractOutlineRows(text)
		.map((row) => `${row.role} ${JSON.stringify(row.name)}`)
		.toSorted()
}

/**
 * Returns the reference of the one outline row with a role and a name, or throws.
 *
 * @param text - The `text` of a `BrowserOutline`, or a toolset receipt that carries one
 * @param role - The row's role, such as `textbox`
 * @param name - The row's decoded name, such as `Name`
 * @returns The row's reference, such as `e3`
 * @throws Thrown when no row or more than one row carries the role and the name, naming both.
 */
export function requireOutlineReference(text: string, role: string, name: string): string {
	const rows = extractOutlineRows(text).filter((row) => row.role === role && row.name === name)
	const [row] = rows
	if (row === undefined || rows.length > 1)
		throw new Error(
			`Expected one outline row ${role} ${JSON.stringify(name)} and found ${rows.length}`,
		)
	return row.reference
}

/**
 * Reads the text a successful tool result carries, or throws with the failure it reports.
 *
 * @param result - A `ToolResult` from `ToolManagerInterface.execute`, or its JSON copy read back
 * from a page
 * @returns The result's string `value`
 * @throws Thrown when the result reports a failure, naming its `error`, and when it carries no
 * string `value`.
 */
export function requireToolText(result: unknown): string {
	if (isRecord(result) && result['success'] === false)
		throw new Error(`The tool call failed: ${String(result['error'])}`)
	if (!isRecord(result) || result['success'] !== true || !isString(result['value']))
		throw new Error('The tool call returned no text')
	return result['value']
}
