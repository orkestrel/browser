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
import type { BrowserPageInterface } from '@src/core'
import { BROWSER_TOOL_CHANGED_NOTE, BROWSER_TOOL_DEADLINE_NOTE, isCDPError } from '@src/core'
import { findSystemBrowser } from '@src/server'
import { isArray, isRecord, isString } from '@orkestrel/contract'
import { waitForCondition } from '@orkestrel/test'
export { reservePort } from './setupServer.js'

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
	'WebMCP.enable answers CDP error -32601 (method not found), so this browser has no page registry to mirror'

/**
 * Probes registry support by the protocol command rather than the incomplete domain listing.
 * @param page - Page session to probe
 * @returns Whether WebMCP.enable succeeds; only a method-not-found refusal returns false
 */
export async function supportsServiceRegistry(page: BrowserPageInterface): Promise<boolean> {
	try {
		await page.send('WebMCP.enable')
		return true
	} catch (error) {
		if (isCDPError(error) && error.context?.['code'] === -32601) return false
		throw error
	}
}

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
 * Extracts the element rows of a rendered outline, in row order, each reference once.
 *
 * @param text - The `text` of a `BrowserOutline`, or a toolset receipt that carries one
 * @returns The reference, role, and JSON-decoded name of each row that opens with a reference
 * such as `e12` followed by a role and a quoted name, at its first occurrence, so a `look` match
 * row that repeats an outline row counts once; heading, text, and summary rows contribute nothing
 */
export function extractOutlineRows(text: string): readonly ServiceOutlineRow[] {
	const seen = new Set<string>()
	return [...text.matchAll(/^(e[1-9]\d*) (\S+) ("(?:[^"\\\n]|\\.)*")/gm)].flatMap((match) => {
		const [, reference, role, quoted] = match
		const name: unknown = JSON.parse(quoted ?? '""')
		if (reference === undefined || role === undefined || !isString(name) || seen.has(reference))
			return []
		seen.add(reference)
		return [{ reference, role, name }]
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
 * Masks element references so two receipts for the same gesture compare by wording.
 *
 * @param text - A receipt or a view
 * @returns The text with every `eN` reference replaced by `e#`
 */
export function maskBrowserReferences(text: string): string {
	return text.replace(/\be[1-9]\d*\b/gu, 'e#')
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

/**
 * Holds the editable regions the role proofs append to a page's `main`: a `contenteditable`
 * region without a role, a `contenteditable` region with `role="textbox"`, a button inside a
 * `contenteditable` region, and a text input with `role="button"`.
 */
export const SERVICE_EDITABLE_HTML = [
	'<div contenteditable="true">Plain notes</div>',
	'<div contenteditable="true" role="textbox" aria-label="Notes"></div>',
	'<div contenteditable="true">Draft <button type="button">Bold</button></div>',
	'<input aria-label="Coupon" role="button">',
].join('')

/**
 * Holds markup that renders more than `BROWSER_TOOL_LIMIT` characters of paragraph text before a
 * text input labelled `Tracking number` whose id is `tracking`.
 */
export const SERVICE_TRACKING_HTML = [
	...Array.from(
		{ length: 60 },
		(_, index) =>
			`<p>Shipment note ${index + 1} records where the parcel waited and who signed for it.</p>`,
	),
	'<label>Tracking number <input id="tracking" type="text"></label>',
].join('')

/**
 * Holds the note a receipt carries when a navigation replaces the page while its view is captured
 * and again while the capture reads it once more: `BROWSER_TOOL_CHANGED_NOTE`.
 */
export const SERVICE_CHANGED_NOTE = BROWSER_TOOL_CHANGED_NOTE

/**
 * Describes the receipt a correct toolset returns for an action whose view capture completes in
 * time.
 *
 * @remarks
 * - `action` — the receipt's action sentence without its closing period, such as
 *   `Clicked e1 textbox "Name"`
 * - `view` — the outline the capture reads
 * - `url` — for an action that navigates, the URL the navigation commits
 */
export interface ServiceReceipt {
	readonly action: string
	readonly view: string
	readonly url?: string
}

/**
 * Checks whether a receipt is one a correct toolset returns for an action on a host whose load
 * or capture can outrun the receipt deadline.
 *
 * @param receipt - The text the tool call returned
 * @param expected - The action sentence, the captured view, and the committed URL of a navigation
 * @returns True if the receipt is the action line followed by the expected view or by
 * `BROWSER_TOOL_DEADLINE_NOTE`, or, when `expected.url` is given, the action line followed by
 * `SERVICE_CHANGED_NOTE`, or the action line naming `the page is still loading URL` followed by
 * the expected view, `SERVICE_CHANGED_NOTE`, or `BROWSER_TOOL_DEADLINE_NOTE`; false otherwise
 * @remarks The expected view is the destination's, so a receipt that captured the page the
 * navigation leaves, or a destination document before its content rendered, is refused.
 */
export function matchesToolReceipt(receipt: string, expected: ServiceReceipt): boolean {
	const line = `${expected.action}.\n\n`
	if (receipt === `${line}${expected.view}` || receipt === `${line}${BROWSER_TOOL_DEADLINE_NOTE}`)
		return true
	if (expected.url === undefined) return false
	if (receipt === `${line}${SERVICE_CHANGED_NOTE}`) return true
	const loading = `${expected.action}; the page is still loading ${expected.url}.\n\n`
	if (!receipt.startsWith(loading)) return false
	const suffix = receipt.slice(loading.length)
	return (
		suffix === expected.view ||
		suffix === SERVICE_CHANGED_NOTE ||
		suffix === BROWSER_TOOL_DEADLINE_NOTE
	)
}

/**
 * Waits until the served document page reports its toolset started, or throws naming the cause.
 *
 * @param page - The page showing the fixture server's `/document` page; only its `evaluate` is read
 * @param budget - The milliseconds the page has to report. Default: 10 000
 * @throws Thrown when the page sets `document.body.dataset.failed`, naming the error it recorded,
 * and when it sets neither flag within `budget`, naming the `dist/src/browser` import the page
 * depends on.
 */
export async function requireDocumentToolset(
	page: { evaluate(expression: string): Promise<unknown> },
	budget = 10_000,
): Promise<void> {
	await waitForCondition(
		'precondition: the document page imported dist/src/browser and started its toolset',
		async () =>
			(await page.evaluate('document.body.dataset.ready ?? document.body.dataset.failed')) !==
			undefined,
		{ budget, interval: 20 },
	)
	const failed = await page.evaluate('document.body.dataset.failed')
	if (failed !== undefined)
		throw new Error(`Precondition failed: the document toolset did not start: ${String(failed)}`)
}
