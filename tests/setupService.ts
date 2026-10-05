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

import type {
	BrowserEngine,
	BrowserInterface,
	BrowserLaunchFunction,
	BrowserOptions,
	SystemBrowser,
	SystemBrowserOptions,
} from '@src/server'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { MCPClientInterface } from '@orkestrel/mcp'
import { BROWSER_TOOL_CHANGED_NOTE, BROWSER_TOOL_DEADLINE_NOTE, createCDPClient } from '@src/core'
import {
	createBrowser,
	createCDPTransport,
	findSystemBrowser,
	parseBrowserProfileRecord,
} from '@src/server'
import { isArray, isRecord, isString } from '@orkestrel/contract'
import { createMCPClient } from '@orkestrel/mcp'
import { createStdioClientTransport } from '@orkestrel/mcp/server'
import { waitForCondition } from '@orkestrel/test'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowseChild, SOURCE_HOOK } from './setupServer.js'
export { reservePort } from './setupServer.js'

/** Serves worker scripts and a page for worker startup proofs.
 * @param request - The fixture HTTP request
 * @param response - The fixture HTTP response
 */
export function handleServiceWorkerFixture(
	request: IncomingMessage,
	response: ServerResponse,
): void {
	if (request.url === '/service-worker.js') {
		response.writeHead(200, { 'content-type': 'text/javascript' })
		response.end("self.addEventListener('install', () => self.skipWaiting())")
		return
	}
	if (request.url === '/dedicated-worker.js') {
		response.writeHead(200, { 'content-type': 'text/javascript' })
		response.end(
			"self.addEventListener('message', event => self.postMessage('dedicated:' + event.data))",
		)
		return
	}
	if (request.url === '/shared-worker.js') {
		response.writeHead(200, { 'content-type': 'text/javascript' })
		response.end(`self.addEventListener('connect', event => {
			const port = event.ports[0]
			port.addEventListener('message', message => port.postMessage('shared:' + message.data))
			port.start()
		})`)
		return
	}
	response.writeHead(200, { 'content-type': 'text/html' })
	response.end('<title>Service worker activation</title>')
}

/** Starts the built browse server with a real browser and a bounded holder pool.
 * @param root - Owned journey and profile directory
 * @returns The connected protocol client and its supervised transport
 */
export async function openHolderServer(root: string) {
	const transport = createStdioClientTransport({
		command: process.execPath,
		args: [resolve('dist/bin/main.js')],
		env: {
			BROWSE_ROOT: root,
			BROWSE_EXECUTABLE: requireSystemBrowser().executable,
			BROWSE_POOL: '3',
			BROWSE_HEADLESS: 'true',
			BROWSE_READONLY: 'false',
			BROWSE_VIEWPORT: '',
		},
	})
	const client = createMCPClient({ transport, identity: { name: 'holders-proof', version: '1' } })
	try {
		await client.connect()
		return Object.freeze({ client, transport })
	} catch (error) {
		await client.disconnect()
		throw error
	}
}

/** Reads a built server's textual tool result, retaining protocol errors as rejections.
 * @param client - Connected server client
 * @param name - Tool name
 * @param args - Tool arguments
 * @returns The tool's text
 */
export async function callHolderServer(
	client: MCPClientInterface,
	name: string,
	args: Readonly<Record<string, unknown>>,
): Promise<string> {
	const result = await client.call(name, args)
	if (result.resultType !== 'complete' || !isString(result.value))
		throw new Error(`Missing ${name} text: ${JSON.stringify(result)}`)
	return result.value
}

/** Acquires a holder and validates the server's returned handle.
 * @param client - Connected server client
 * @param purpose - Work description
 * @returns The holder identifier
 */
export async function acquireHolder(client: MCPClientInterface, purpose: string): Promise<string> {
	const result = await client.call('acquire', { purpose })
	if (
		result.resultType !== 'complete' ||
		!isRecord(result.value) ||
		!isString(result.value['holder'])
	)
		throw new Error('Missing holder handle')
	return result.value['holder']
}

/** Records and saves a navigation through a built server's journey tools.
 * @param client - Connected server client
 * @param journey - Unused journey name
 * @param url - Destination to record
 * @param holder - Named holder, or the shared browser when omitted
 */
export async function recordHolderJourney(
	client: MCPClientInterface,
	journey: string,
	url: string,
	holder?: string,
): Promise<void> {
	for (const call of [
		{ name: 'record', arguments: { journey } },
		{ name: 'navigate', arguments: { url } },
		{ name: 'save', arguments: { description: `Navigate to ${journey}` } },
	]) {
		await callHolderServer(
			client,
			holder === undefined ? call.name : 'execute',
			holder === undefined ? call.arguments : { holder, ...call },
		)
	}
}

/** Locates a real holder's process and profile by its observable page URL.
 * @param root - Server's profile root
 * @param url - URL reached through that holder's navigation
 * @returns The owned profile and Chromium identity
 */
export async function findHolderProfile(root: string, url: string) {
	for (const name of readdirSync(join(root, '.profiles'))) {
		const profile = join(root, '.profiles', name)
		const record = parseBrowserProfileRecord(readFileSync(join(profile, 'browse.json'), 'utf8'))
		if (record === undefined) throw new Error('Missing browser record')
		const client = createCDPClient({ transport: createCDPTransport({ url: record.endpoint }) })
		try {
			await client.connect()
			const targets: unknown = await client.send('Target.getTargets')
			if (
				isRecord(targets) &&
				isArray(targets['targetInfos']) &&
				targets['targetInfos'].some((target: unknown) => isRecord(target) && target['url'] === url)
			)
				return Object.freeze({ profile, ...record })
		} finally {
			await client.close()
		}
	}
	throw new Error(`No holder has reached ${url}`)
}

/** Names both atomic record paths whose obstruction must fail a warm. */
export const BROWSE_RECORD_BLOCKS: readonly string[] = Object.freeze([
	'browse.json',
	'browse.json.tmp',
])

/** Explains why a runtime refusing SIGSTOP cannot prove stopped-process recovery. */
export const BROWSE_SIGSTOP_REASON =
	'NOT-EVIDENCED: SIGSTOP is refused by the runtime with ERR_UNKNOWN_SIGNAL'

/** Explains why a Windows runtime cannot prove a child's cooperative SIGTERM ending. */
export const BROWSE_SIGTERM_REASON =
	'NOT-EVIDENCED: Node ends a Windows child outright on SIGTERM, so its cooperative handler cannot run'

/** Explains why an unlinkable process working directory cannot inject a cleanup refusal. */
export const BROWSE_DIRECTORY_REASON =
	'NOT-EVIDENCED: removing a live process working directory succeeds on this filesystem'

/** Records the process and endpoint a real browser announced when it connected. */
export interface BrowseConnection {
	readonly pid: number | undefined
	readonly endpoint: string | undefined
	readonly options: BrowserOptions
}

/** Records real browser launches and their connected process identities. */
export class BrowseLauncher {
	readonly #browsers: BrowserInterface[] = []
	readonly #connections: BrowseConnection[] = []
	/** Lists the real browser wrappers in launch order. */
	get browsers(): readonly BrowserInterface[] {
		return this.#browsers
	}
	/** Lists the process identities observed at connection. */
	get connections(): readonly BrowseConnection[] {
		return this.#connections
	}
	/** Creates each real browser and observes its connection. */
	get launch(): BrowserLaunchFunction {
		return (options) => {
			const browser = createBrowser(options)
			this.#browsers.push(browser)
			browser.emitter.on('connect', () =>
				this.#connections.push({ pid: browser.pid, endpoint: browser.endpoint, options }),
			)
			return browser
		}
	}
}

/** Starts a child running the source browse server, for orphan recovery proofs.
 * @param root - Owned fixture root
 * @param executable - Real browser executable
 * @returns The child process and its recorded output
 */
export function createEagerBrowseChild(root: string, executable: string): BrowseChild {
	const entry = join(root, 'browse-child.ts')
	const manifest = pathToFileURL(resolve('package.json')).href
	const version = `const manifest = ${readFileSync('package.json', 'utf8')}; export const version = manifest.version`
	// The source uses the named JSON export the bundler supplies; Node's JSON module has only a default export.
	writeFileSync(
		entry,
		`import { registerHooks } from 'node:module'\nimport { resolve } from 'node:path'\nimport { pathToFileURL } from 'node:url'\n${SOURCE_HOOK}\nregisterHooks({ load(url, context, next) { return url === ${JSON.stringify(manifest)} ? { format: 'module', source: ${JSON.stringify(version)}, shortCircuit: true } : next(url, context) } })\nconst { createBrowserMCPServer } = await import(${JSON.stringify(pathToFileURL(resolve('src/server/index.ts')).href)})\nconst server = createBrowserMCPServer({ root: ${JSON.stringify(root)}, executable: ${JSON.stringify(executable)} })\nawait server.start()\nconsole.log('ready')\n`,
	)
	return new BrowseChild(entry, process.cwd(), {})
}

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
 * Collects complete element rows without references, sorted for comparison between placements.
 *
 * @param text - An outline or receipt, including an optional repeated matches block
 * @returns One role, name, and state suffix per reference, keeping the first occurrence
 */
export function collectOutlineEntries(text: string): readonly string[] {
	const seen = new Set<string>()
	return text
		.split(/\r\n|\n/)
		.flatMap((line) => {
			const match = /^(e[1-9]\d*) (\S+ "(?:[^"\\]|\\.)*".*)$/.exec(line)
			const reference = match?.[1]
			const entry = match?.[2]
			if (reference === undefined || entry === undefined || seen.has(reference)) return []
			seen.add(reference)
			return [entry]
		})
		.toSorted()
}

/** Supplies toggle, expansion, selection, and absent-state controls for both placements. */
export const SERVICE_TOGGLE_HTML =
	'<button aria-pressed="true">Toggle on</button><button aria-pressed="false">Toggle off</button><button aria-pressed="mixed">Toggle mixed</button><button aria-pressed="TRUE">Uppercase toggle</button><button aria-pressed="foo">Unknown toggle</button><button aria-pressed=" false ">Spaced toggle</button><button aria-pressed="">Empty toggle</button><button aria-pressed="undefined">Undefined toggle</button><button aria-expanded="mixed">Mixed expansion</button><button aria-expanded="foo">Unknown expansion</button><button>Plain toggle control</button><button aria-expanded="false">Disclosure</button><a href="#" aria-expanded="true">Expanded link</a><div role="tablist"><button role="tab" aria-selected="true">Selected tab</button><button role="tab" aria-selected="false">Unselected tab</button><button role="tab">Default tab</button></div><div role="tree"><div role="treeitem" aria-selected="true">Selected treeitem</div><div role="treeitem" aria-selected="false">Unselected treeitem</div><div role="treeitem">Default treeitem</div></div><div role="listbox" aria-label="ARIA choices"><div role="option" aria-selected="true">Selected option</div><div role="option" aria-selected="false">Unselected option</div><div role="option">Default option</div><div role="option" aria-selected="">Empty option</div><div role="option" aria-selected="undefined">Undefined option</div></div><select aria-label="Native"><option>Native first</option><option selected>Native chosen</option></select><select aria-label="Override" aria-expanded="true"><option selected aria-selected="false">Native false</option><option aria-selected="true">Native true</option></select>'

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
	try {
		await waitForCondition(
			'precondition: the document page imported dist/src/browser and started its toolset',
			async () =>
				(await page.evaluate('document.body.dataset.ready ?? document.body.dataset.failed')) !==
				undefined,
			{ budget, interval: 20 },
		)
	} catch (error) {
		console.error(
			'document startup state',
			await page.evaluate(
				'({url: location.href, visibility: document.visibilityState, readyState: document.readyState, dataset: {...document.body.dataset}, toolset: typeof window.documentToolset, resources: performance.getEntriesByType("resource").map(e => ({name: e.name, duration: e.duration, size: e.transferSize, status: e.responseStatus}))})',
			),
		)
		throw error
	}
	const failed = await page.evaluate('document.body.dataset.failed')
	if (failed !== undefined)
		throw new Error(`Precondition failed: the document toolset did not start: ${String(failed)}`)
}
