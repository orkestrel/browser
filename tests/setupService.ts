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
	createWebSocketCDPTransport,
	findSystemBrowsers,
	parseBrowserProfileRecord,
} from '@src/server'
import { isArray, isRecord, isString } from '@orkestrel/contract'
import { createMCPClient } from '@orkestrel/mcp'
import { createStdioClientTransport } from '@orkestrel/mcp/server'
import { requireValue, waitForCondition, waitForEvent } from '@orkestrel/test'
import { createLoopback } from '@orkestrel/test/server'
import { createServer } from 'node:http'
import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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
 * @param pool - Number of pooled browsers
 * @param contexts - Per-browser holder bound, or the server default when omitted
 * @returns The connected protocol client and its supervised transport
 */
export async function openHolderServer(root: string, pool = 3, contexts?: number) {
	const transport = createStdioClientTransport({
		command: process.execPath,
		args: [resolve('dist/bin/main.js')],
		env: {
			BROWSE_ROOT: root,
			BROWSE_EXECUTABLE: requireSystemBrowser().executable,
			BROWSE_POOL: String(pool),
			BROWSE_CONTEXTS: contexts === undefined ? '' : String(contexts),
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
		const client = createCDPClient({
			transport: createWebSocketCDPTransport({ url: record.endpoint }),
		})
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

/** Owns the HTTP witness for context state exercised through the built server. */
export class ContextFixture {
	readonly #events = new EventEmitter()
	readonly #counts = new Map<string, number>()
	readonly #barriers = new Map<string, ServerResponse[]>()
	#server: Awaited<ReturnType<typeof createLoopback>> | undefined

	get url(): string {
		return requireValue(this.#server, 'context origin').url
	}

	async start(): Promise<void> {
		this.#server = await createLoopback(createServer(this.#respond.bind(this)))
	}

	count(path: string): number {
		return this.#counts.get(path) ?? 0
	}

	async read(client: MCPClientInterface, holder?: string, query = '') {
		const ticket = randomUUID()
		const url = `${this.url}/state?ticket=${ticket}&${query}`
		const abort = new AbortController()
		const ready = waitForEvent(
			(listener) => {
				this.#events.once(ticket, listener)
				return () => this.#events.off(ticket, listener)
			},
			'context fixture finished its web-state operations',
			{ budget: 5000, signal: abort.signal },
		)
		try {
			await Promise.all([callContextTool(client, holder, 'navigate', { url }), ready])
		} finally {
			abort.abort()
		}
		const text = await callContextTool(client, holder, 'read', { from: 1 })
		const json = requireValue(text.match(/\{"cookie":.*\}/)?.[0], `context state in ${text}`)
		const state: unknown = JSON.parse(json)
		if (!isRecord(state)) throw new Error('Invalid context state')
		return Object.freeze({ url, state })
	}

	async destroy(): Promise<void> {
		for (const waiting of this.#barriers.values())
			for (const response of waiting) response.end('Fixture ended')
		this.#barriers.clear()
		await this.#server?.destroy()
		this.#events.removeAllListeners()
	}

	#respond(request: IncomingMessage, response: ServerResponse): void {
		const path = (request.url ?? '/').split('?')[0] ?? '/'
		if (path.startsWith('/barrier/')) {
			const waiting = this.#barriers.get(path) ?? []
			waiting.push(response)
			this.#barriers.set(path, waiting)
			if (waiting.length === 2) {
				for (const pending of waiting) pending.end('Both holders are busy')
				this.#barriers.delete(path)
			}
		} else if (path.startsWith('/ready/')) {
			response.end('ready')
			this.#events.emit(path.slice('/ready/'.length))
		} else if (path === '/worker.js') {
			response.writeHead(200, { 'Content-Type': 'text/javascript' })
			response.end("self.addEventListener('install', () => self.skipWaiting())")
		} else if (path.startsWith('/cached/')) {
			this.#counts.set(path, this.count(path) + 1)
			response.writeHead(200, { 'Cache-Control': 'public, max-age=3600' })
			response.end('Cached context response')
		} else if (path.startsWith('/download/')) {
			response.writeHead(200, {
				'Content-Type': 'application/octet-stream',
				'Content-Disposition': 'attachment; filename="context.txt"',
			})
			response.end(path.slice('/download/'.length))
		} else {
			response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
			response.end(readFileSync(new URL('./fixtures/contexts.html', import.meta.url)))
		}
	}
}

/** Selects the shared or named holder's real transport entry.
 * @param client - Connected built server
 * @param holder - Named holder, or the shared holder when omitted
 * @param name - Browser tool name
 * @param args - Browser tool arguments
 * @returns The transport's textual receipt
 */
export async function callContextTool(
	client: MCPClientInterface,
	holder: string | undefined,
	name: string,
	args: Readonly<Record<string, unknown>>,
): Promise<string> {
	return callHolderServer(
		client,
		holder === undefined ? name : 'execute',
		holder === undefined ? args : { holder, name, arguments: args },
	)
}

/** Attaches an independent CDP observer to a holder reached through MCP.
 * @param root - Built server's owned root
 * @param url - Holder's unique fixture URL
 * @returns The observer, context identity, target identity and browser record
 */
export async function inspectHolderContext(root: string, url: string) {
	const profile = await findHolderProfile(root, url)
	const client = createCDPClient({
		transport: createWebSocketCDPTransport({ url: profile.endpoint }),
	})
	await client.connect()
	try {
		const result: unknown = await client.send('Target.getTargets')
		if (!isRecord(result) || !isArray(result['targetInfos'])) throw new Error('Missing targets')
		const target = result['targetInfos'].find((entry) => isRecord(entry) && entry['url'] === url)
		if (!isRecord(target) || !isString(target['targetId']) || !isString(target['browserContextId']))
			throw new Error('Missing isolated holder target')
		return Object.freeze({
			...profile,
			client,
			context: target['browserContextId'],
			target: target['targetId'],
		})
	} catch (error) {
		await client.close()
		throw error
	}
}

/** Declares source readbacks and clean-context values for the C2 isolation matrix. */
export const CONTEXT_STORES = Object.freeze([
	{ name: 'cookie', source: 'marker=source', empty: '' },
	{ name: 'local', source: 'source', empty: null },
	{ name: 'session', source: 'source', empty: null },
	{ name: 'indexed', source: 'source', empty: null },
	{ name: 'cache', source: 'source', empty: null },
	{ name: 'worker', source: ['activated'], empty: [] },
	{ name: 'permission', source: 'granted', empty: 'prompt' },
])

/** Downloads a marker through the holder tool and observes its completed file without polling.
 * @param client - Connected built server
 * @param holder - Named or shared holder
 * @param profile - Observed browser profile
 * @param marker - Expected content of the fixture download
 * @param target - Holder's independently observed page target
 * @param link - Accessible name of the fixture's download link
 * @param filename - Filename declared by the fixture's download response
 * @returns The completed file's path
 */
export async function downloadContextFile(
	client: MCPClientInterface,
	holder: string | undefined,
	profile: string,
	marker: string,
	target: string,
	link = 'Download context file',
	filename = 'context.txt',
): Promise<string> {
	const outline = await callContextTool(client, holder, 'read', { from: 1, search: '' })
	const ref = requireOutlineReference(outline, 'link', link)
	const record = requireValue(
		parseBrowserProfileRecord(readFileSync(join(profile, 'browse.json'), 'utf8')),
	)
	const observer = createCDPClient({
		transport: createWebSocketCDPTransport({ url: record.endpoint }),
	})
	await observer.connect()
	const abort = new AbortController()
	try {
		const attached: unknown = await observer.send('Target.attachToTarget', {
			targetId: target,
			flatten: true,
		})
		if (!isRecord(attached) || !isString(attached['sessionId']))
			throw new Error('Missing download session')
		const session = attached['sessionId']
		await observer.send('Page.enable', undefined, { session })
		const progress = waitForEvent(
			(listener) => {
				observer.subscribe(
					'Page.downloadProgress',
					(params) => {
						if (params['state'] === 'completed') listener()
					},
					session,
				)
				return () => undefined
			},
			'Chromium completed the download',
			{ budget: 5000, signal: abort.signal },
		)
		await Promise.all([callContextTool(client, holder, 'click', { ref }), progress])
		return requireValue(
			readContextFolders(profile)
				.map((folder) => join(folder, filename))
				.find((path) => existsSync(path) && readFileSync(path, 'utf8') === marker),
			`completed ${marker} file`,
		)
	} finally {
		abort.abort()
		await observer.close()
	}
}

/** Reads the live context download folders from a real browser profile.
 * @param profile - Browser's recorded profile
 * @returns Existing download directories
 */
export function readContextFolders(profile: string): readonly string[] {
	return readdirSync(join(profile, 'contexts'))
		.map((entry) => join(profile, 'contexts', entry, 'downloads'))
		.filter((path) => existsSync(path))
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
		`import { registerHooks } from 'node:module'\nimport { resolve } from 'node:path'\nimport { pathToFileURL } from 'node:url'\n${SOURCE_HOOK}\nregisterHooks({ load(url, context, next) { return url === ${JSON.stringify(manifest)} ? { format: 'module', source: ${JSON.stringify(version)}, shortCircuit: true } : next(url, context) } })\nconst { createBrowserMCPServer } = await import(${JSON.stringify(pathToFileURL(resolve('src/server/index.ts')).href)})\nconst server = createBrowserMCPServer({ root: ${JSON.stringify(root)}, browser: { executable: ${JSON.stringify(executable)} } })\nawait server.start()\nconsole.log('ready')\n`,
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
	const found = findSystemBrowsers(options ?? (engine === undefined ? undefined : { engine }))[0]
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
 * @returns The number after the `e` in each row’s `[ref=eN]` token;
 * heading, text, and summary rows contribute nothing
 */
export function extractOutlineReferences(text: string): readonly number[] {
	return extractOutlineRows(text).map((row) => Number(row.reference.slice(1)))
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
 * @returns The reference, role, and JSON-decoded name of each row with `[ref=eN]` after its
 * optional quoted name, at its first occurrence, so a `read` match
 * row that repeats an outline row counts once; heading, text, and summary rows contribute nothing
 */
export function extractOutlineRows(text: string): readonly ServiceOutlineRow[] {
	const seen = new Set<string>()
	return [
		...text.matchAll(
			/^(?:\d+: )?(?:#{1,6} |- )?(\S+)(?: ("(?:[^"\\\n]|\\.)*"))? \[ref=(e[1-9]\d*)\]/gm,
		),
	].flatMap((match) => {
		const [, role, quoted, reference] = match
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
			const match =
				/^(?:\d+: )?(?:#{1,6} |- )?(\S+(?: "(?:[^"\\]|\\.)*")?) \[ref=(e[1-9]\d*)\](.*)$/.exec(line)
			const reference = match?.[2]
			const entry = match === null ? undefined : `${match[1]}${match[3]}`
			if (reference === undefined || entry === undefined || seen.has(reference)) return []
			seen.add(reference)
			return [entry]
		})
		.toSorted()
}

/** Supplies toggle, expansion, selection, and absent-state controls for both placements. */
export const SERVICE_TOGGLE_HTML =
	'<button aria-pressed="true">Toggle on</button><button aria-pressed="false">Toggle off</button><button aria-pressed="mixed">Toggle mixed</button><button aria-pressed="TRUE">Uppercase toggle</button><button aria-pressed="foo">Unknown toggle</button><button aria-pressed=" false ">Spaced toggle</button><button aria-pressed="">Empty toggle</button><button aria-pressed="undefined">Undefined toggle</button><button aria-expanded="mixed">Mixed expansion</button><button aria-expanded="foo">Unknown expansion</button><button>Plain toggle control</button><button aria-expanded="false">Disclosure</button><a href="#" aria-expanded="true">Expanded link</a><div role="tablist"><button role="tab" aria-selected="true">Selected tab</button><button role="tab" aria-selected="false">Unselected tab</button><button role="tab">Default tab</button></div><div role="tree"><div role="treeitem" aria-selected="true">Selected treeitem</div><div role="treeitem" aria-selected="false">Unselected treeitem</div><div role="treeitem">Default treeitem</div></div><div role="listbox" aria-label="ARIA choices"><div role="option" aria-selected="true">Selected option</div><div role="option" aria-selected="false">Unselected option</div><div role="option">Default option</div><div role="option" aria-selected="">Empty option</div><div role="option" aria-selected="undefined">Undefined option</div></div><select aria-label="Native"><option>Native first</option><option selected>Native chosen</option></select><select aria-label="Override" aria-expanded="true"><option selected aria-selected="false">Native false</option><option aria-selected="true">Native true</option></select>'

/** Defines handled submissions with semantic and unrelated changes after the submit event. */
export const SERVICE_READING_SUBMISSIONS = [
	{
		name: 'synchronous',
		code: 'document.querySelector("output").textContent = "Order confirmed"',
		changed: true,
	},
	{
		name: 'delayed',
		code: 'setTimeout(() => document.querySelector("output").textContent = "Order confirmed", 200)',
		changed: true,
	},
	{
		name: 'aria-hidden',
		code: 'setTimeout(() => { const hidden=document.createElement("p"); hidden.setAttribute("aria-hidden","true"); hidden.textContent="Invisible update"; document.body.append(hidden) }, 200)',
		changed: false,
	},
	{ name: 'unchanged', code: '', changed: false },
	{
		name: 'bookkeeping',
		code: 'setTimeout(() => document.body.dataset.tick = "1", 200)',
		changed: false,
	},
	{
		name: 'hidden',
		code: 'setTimeout(() => document.querySelector("aside").textContent = "hidden change", 200)',
		changed: false,
	},
]

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
 *   `Clicked textbox "Name" [ref=e1]`
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

/** Supplies ordinary catalogue and policy paragraphs copied from the ollama store fixture on 2026-10-06. */
export const SERVICE_STORE_PARAGRAPHS: readonly string[] = [
	'“The kettle has lived on our stove for three winters and still sings like the first morning.” — Maren, Tromsø',
	'“The board arrived oiled and ready, wrapped in paper with a note from the maker who cut it.” — Idris, Leeds',
	'“I ordered a mug for my father and the workshop wrote back to ask which glaze he would like.” — Paloma, Seville',
	'“The apron softened after one wash and the pockets hold a notebook, a pencil, and a phone.” — Kenji, Sapporo',
	'“Our cafe has used the trays for two years. Not one has warped, even on the terrace.” — Aoife, Galway',
	'“The spice rack fitted the gap beside the window exactly, and the walnut glows in the evening.” — Tomas, Brno',
	'“I asked how to restore an old board and the workshop sent a page of notes and a tin of wax.” — Lior, Haifa',
	'“Every parcel comes in paper and card, and the card goes straight into our recycling.” — Nadia, Casablanca',
	'“The kettle handle stays cool enough to hold without a cloth, which my hands appreciate.” — Rosa, Porto',
	'“The mug holds exactly one pot of tea, so nobody in our house argues about the last cup.” — Emeka, Enugu',
	'“We visited the workshop on the first Saturday and watched a kettle take shape in an hour.” — Sofie, Aarhus',
	'“The tea tray drains into its hidden reservoir, so the table stays dry through a long afternoon.” — Ravi, Pune',
	'“The board still looks new after a year of daily bread, onions, and one very sharp knife.” — Hanne, Bergen',
	'“A replacement for a chipped mug arrived within the week, and they did not ask for the old one.” — Dario, Turin',
	'“The copper has darkened to a warm brown, and I like it more each month it sits on the hob.” — Ines, Lisbon',
	'Harbor Goods began as a market stall on the east pier, selling kettles and boards made by three families of makers who shared one workshop behind the fish market.',
	'Every piece we sell is made in small batches. The kettles are spun and hammered by hand, the boards are cut from trees that fell in winter storms, and the mugs are thrown and glazed in a kiln that runs twice a week.',
	'We test each kettle on gas, electric, and induction hobs before it leaves the workshop, and we oil each board three times over a week so that it arrives ready for a knife.',
	'We pack every order in paper and card from the recycling yard down the road. No plastic leaves our workshop, and every box can go straight into your own recycling bin.',
	'Gift wrapping is free on every order. Choose it at checkout and we will add a handwritten card with any message you like, up to forty words.',
	'Prices include tax. We do not charge for returns, and we never add a fee at checkout that the product page did not show you first.',
	'Our workshop opens to visitors on the first Saturday of each month. Come and watch a kettle being hammered, or bring an old board and we will show you how to restore it.',
	'We donate one percent of every sale to the harbour trust, which keeps the pier, the lighthouse, and the tidal pool in repair for everyone who lives and works here.',
	'Stock is small and batches sell out. When a piece is gone, the makers start the next batch within a fortnight, and the product page shows the date the batch is due.',
	'We answer every message ourselves, usually within one working day. Tell us what you cook and how you cook it, and we will suggest the piece that suits your kitchen.',
	'We ship to every address in the country, including islands and remote postcodes. Parcels to the islands travel by ferry and can take one extra working day. We do not ship to parcel lockers, because a kettle box is too large for most of them.',
	'Every order is packed by hand in paper and card. Kettles travel in a moulded pulp cradle, boards travel wrapped in kraft paper, and mugs travel in a honeycomb sleeve that protects the glaze. We never use plastic fill.',
	'Standard parcels travel with the national post. Heavy parcels, over ten kilograms, travel with a courier who books a delivery window by text message. Both carriers give you a tracking link on the day your parcel leaves the workshop.',
	'Standard delivery takes two to four working days on the mainland. Express delivery takes one working day on the mainland and two to the islands. Delivery times start from the day the parcel leaves the workshop, not from the day you order.',
	'Standard delivery is free on orders over sixty dollars and costs six dollars below that. Express delivery costs fourteen dollars on every order. Heavy parcels cost the same as standard parcels; the workshop pays the difference.',
	'Parcels worth more than one hundred dollars need a signature. If nobody is home, the carrier leaves a card and holds the parcel at the nearest depot for ten days. You can name a neighbour at checkout who can sign on your behalf.',
	'If a parcel returns to us after ten days at the depot, we write to you and send it again once, free of charge. A parcel that returns a second time is refunded in full, minus the delivery price of the second attempt.',
	'Open your parcel within seven days and check every piece. If anything is damaged, photograph it with the box and write to us. We send a replacement or refund the full price, and you keep the damaged piece; we never ask for it back.',
	'If tracking shows no movement for five working days, write to us. We open a claim with the carrier and send a replacement the same day, without waiting for the claim to finish. You do not need to contact the carrier yourself.',
	'You can change the delivery address until the parcel leaves the workshop. After that, the carrier can redirect it for a fee that the carrier sets. Write to us with the order number and the new address and we will arrange it.',
	'A gift order ships without a price list inside the box. Add the recipient address at checkout and your own address for the receipt. The handwritten card travels inside the box, sealed in its own envelope.',
	'We do not ship abroad yet. Visitors from abroad can collect an order at the workshop on the first Saturday of each month; choose collection at checkout and bring the order number with you.',
	'You can collect any order at the workshop on the east pier. Collection is free and the order is ready one working day after you place it. We hold a collection order for thirty days before we refund it.',
	'To return an unwanted piece, write to us within thirty days. We send a prepaid label by email. Pack the piece in its original box if you still have it, and drop the parcel at any post office. We refund the full price when it reaches us.',
	'During storms the ferry to the islands can stop for several days, and parcels wait at the harbour depot until it runs again. Between the last week of December and the first working day of January the workshop is closed and nothing ships.',
	'The tracking link arrives by email on the day the parcel leaves the workshop. It shows each scan the carrier records: collection, the sorting depot, the local depot, and the delivery van. A parcel can go a day without a scan while it travels between depots.',
	'You can send an order to a workplace. Add the company name on the address line and the floor or department on the second line, so the post room can find you. Most post rooms sign for parcels, so a workplace delivery rarely misses.',
	'At checkout you can name a safe place, such as a porch or a shed, where the carrier may leave a parcel that needs no signature. The carrier photographs the parcel where it was left, and the photograph appears on the tracking page.',
	'When part of an order is waiting for a new batch, we ship the pieces that are ready and send the rest when the batch is finished. You pay delivery once, and each parcel carries its own tracking link.',
	'Cake stands, serving platters, and shelving travel with the courier because they need two people to carry or careful handling. The courier books a delivery window with you by text message the day before.',
	'You can add or remove pieces until the order is packed. Write to us with the order number and the change. When a change lowers the price, we refund the difference; when it raises the price, we send a payment link for the difference.',
	'You can cancel an order at any time before it leaves the workshop, and we refund the full price the same day. After it leaves, the returns section applies, and the prepaid return label is still free.',
	'Refunds go back to the card or account you paid with. Most banks show a refund within three working days of the day we send it; some take up to ten. We write to you on the day we send each refund.',
	'Every order ships from and to an address in this country, so no customs forms or duties apply. When we begin to ship abroad, this section will state the duties each destination charges.',
	'Write to the workshop by email or through the contact form. We answer every message ourselves, usually within one working day. Include the order number when you have one, so we can find your order quickly.',
	'Before a parcel leaves the bench, a second packer checks the piece against the packing slip. They inspect handles, lids, edges, and glaze, and replace any wrapping that has shifted. The signed slip travels inside the box so a recipient can see who checked the contents.',
	'A clean carton from an incoming supply can carry an outgoing parcel when its walls remain firm. Old address labels are removed and seams receive fresh paper tape. A reused carton receives the same inspection and protection as a carton cut for the first time.',
	'Orders placed close together can travel in one box when their destinations agree. Write before packing begins and include both order numbers. Each piece stays on its own packing slip, and any delivery charge saved by combining the parcels goes back to the original payment.',
	'A carrier needs a clear route to the entrance. Include gate instructions and a working contact number when you order. If a road closes after dispatch, contact the carrier through the tracking link to agree on an accessible meeting place or a later delivery day.',
	'Set a parcel on a firm table before cutting the tape. Lift the paper layers apart instead of pulling on handles or rims. Keep the cradle until every piece has been checked, because the shaped supports make a return trip less likely to damage the contents.',
	'Paper sleeves can be flattened and kept for storing pieces between uses. Keep them dry and away from a cooker. Pulp cradles fit in paper recycling where that service accepts moulded paper, and the workshop can take clean cradles back during collection hours.',
	'The label states the packed weight, which includes the carton and its protective supports. It may differ from the weight listed for an individual piece. Heavy cartons carry a handling mark and remain within the limits agreed with the carrier for a safe lift.',
	'Keep the receipt until every piece has arrived and been checked. If an email goes missing, send the order number and the address used at checkout. The workshop can send another copy to that address without changing the contents or the date of the original receipt.',
	'During wet months each carton receives an extra folded paper liner. During hot months waxed boards are wrapped only after cooling on the shelf. These changes protect the pieces in transit and do not change the delivery price or the return period.',
	'A recipient can request care notes without seeing the price paid for a gift. The packing slip names the piece and its maker. If a gift needs a replacement, either the sender or the recipient can contact the workshop with the number printed on that slip.',
	'Take the delivery card and the identification the carrier requests when collecting from a depot. A person collecting on your behalf may need a signed note. Check the opening hours on the carrier notice before travelling, because depot hours differ from post office hours.',
	'Keep photographs and tracking notices together while an enquiry is open. The workshop records each reply with the order, so a later message can continue the same conversation. Tell the workshop when a delayed parcel arrives so the carrier can close its enquiry.',
]

/** Carries Harbor Goods HTML and approved, port-masked seed bytes from the named ollama records. */
export const SERVICE_LINE_VIEW_RECORDS = Object.freeze([
	{
		record: 'validate-4/2b/T1+P1/attempts/inputs/49171-cart.json',
		html: '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<link rel="icon" href="data:,">\n<title>Harbor Goods — Catalogue</title>\n</head>\n<body>\n<header>\n<nav aria-label="Store">\n<a href="/">Catalogue</a>\n<a href="/cart">Cart</a>\n<a href="/checkout">Checkout</a>\n</nav>\n</header>\n<main>\n<h1>Harbor Goods</h1>\n<form action="/search" method="get" role="search">\n<label for="q">Search products</label>\n<input id="q" type="search" name="q">\n<button type="submit">Search</button>\n</form>\n<h2>Featured products</h2>\n<ul>\n<li><h3><a href="/product/p2">Birch Cutting Board</a></h3><p>$22.50. An end-grain birch board with a juice groove on one face.</p></li>\n<li><h3><a href="/product/p3">Cedar Tea Tray</a></h3><p>$41.00. A slatted cedar tray that drains into a hidden reservoir.</p></li>\n<li><h3><a href="/product/p5">Linen Apron</a></h3><p>$18.00. A washed linen apron with two deep pockets and cross-back straps.</p></li>\n<li><h3><a href="/product/p6">Stoneware Mug</a></h3><p>$12.00. A speckled stoneware mug that holds 350 millilitres.</p></li>\n<li><h3><a href="/product/p7">Walnut Spice Rack</a></h3><p>$29.00. A three-tier walnut rack that holds eighteen standard jars.</p></li>\n<li><h3><a href="/product/p8">Oak Bread Bin</a></h3><p>$46.00. A roll-top oak bin that keeps two loaves fresh for four days.</p></li>\n<li><h3><a href="/product/p9">Wool Tea Cosy</a></h3><p>$16.00. A felted wool cosy that keeps a six-cup pot hot for an hour.</p></li>\n</ul>\n<p>Search to see the whole range.</p>\n<aside>\n<p>What customers say</p>\n<p>“The kettle has lived on our stove for three winters and still sings like the first morning.” — Maren, Tromsø</p>\n<p>“The board arrived oiled and ready, wrapped in paper with a note from the maker who cut it.” — Idris, Leeds</p>\n<p>“I ordered a mug for my father and the workshop wrote back to ask which glaze he would like.” — Paloma, Seville</p>\n<p>“The apron softened after one wash and the pockets hold a notebook, a pencil, and a phone.” — Kenji, Sapporo</p>\n<p>“Our cafe has used the trays for two years. Not one has warped, even on the terrace.” — Aoife, Galway</p>\n<p>“The spice rack fitted the gap beside the window exactly, and the walnut glows in the evening.” — Tomas, Brno</p>\n<p>“I asked how to restore an old board and the workshop sent a page of notes and a tin of wax.” — Lior, Haifa</p>\n<p>“Every parcel comes in paper and card, and the card goes straight into our recycling.” — Nadia, Casablanca</p>\n<p>“The kettle handle stays cool enough to hold without a cloth, which my hands appreciate.” — Rosa, Porto</p>\n<p>“The mug holds exactly one pot of tea, so nobody in our house argues about the last cup.” — Emeka, Enugu</p>\n<p>“We visited the workshop on the first Saturday and watched a kettle take shape in an hour.” — Sofie, Aarhus</p>\n<p>“The tea tray drains into its hidden reservoir, so the table stays dry through a long afternoon.” — Ravi, Pune</p>\n<p>“The board still looks new after a year of daily bread, onions, and one very sharp knife.” — Hanne, Bergen</p>\n<p>“A replacement for a chipped mug arrived within the week, and they did not ask for the old one.” — Dario, Turin</p>\n<p>“The copper has darkened to a warm brown, and I like it more each month it sits on the hob.” — Ines, Lisbon</p>\n</aside>\n<h2>Our story</h2>\n<p>Harbor Goods began as a market stall on the east pier, selling kettles and boards made by three families of makers who shared one workshop behind the fish market.</p>\n<p>Every piece we sell is made in small batches. The kettles are spun and hammered by hand, the boards are cut from trees that fell in winter storms, and the mugs are thrown and glazed in a kiln that runs twice a week.</p>\n<p>We test each kettle on gas, electric, and induction hobs before it leaves the workshop, and we oil each board three times over a week so that it arrives ready for a knife.</p>\n<p>We pack every order in paper and card from the recycling yard down the road. No plastic leaves our workshop, and every box can go straight into your own recycling bin.</p>\n<p>Gift wrapping is free on every order. Choose it at checkout and we will add a handwritten card with any message you like, up to forty words.</p>\n<p>Prices include tax. We do not charge for returns, and we never add a fee at checkout that the product page did not show you first.</p>\n<p>Our workshop opens to visitors on the first Saturday of each month. Come and watch a kettle being hammered, or bring an old board and we will show you how to restore it.</p>\n<p>We donate one percent of every sale to the harbour trust, which keeps the pier, the lighthouse, and the tidal pool in repair for everyone who lives and works here.</p>\n<p>Stock is small and batches sell out. When a piece is gone, the makers start the next batch within a fortnight, and the product page shows the date the batch is due.</p>\n<p>We answer every message ourselves, usually within one working day. Tell us what you cook and how you cook it, and we will suggest the piece that suits your kitchen.</p>\n<h2>Shipping</h2>\n<p>Orders placed before 2:40 PM ship the same working day. Orders placed later ship the next working day.</p>\n</main>\n\n</body>\n</html>\n',
		expected:
			'page "Harbor Goods — Catalogue" http://127.0.0.1:PORT/ (52 lines)\nThis read shows lines 1–45 of 52; lines 46–52 are not shown yet.\n1: link "Catalogue" [ref=e1] /\n2: link "Cart" [ref=e2] /cart\n3: link "Checkout" [ref=e3] /checkout\n4: # Harbor Goods\n5: Search products\n6: searchbox "Search products" [ref=e4]\n7: button "Search" [ref=e5]\n8: ## Featured products\n9: ### link "Birch Cutting Board" [ref=e6] /product/p2\n10: - $22.50. An end-grain birch board with a juice groove on one face.\n11: ### link "Cedar Tea Tray" [ref=e7] /product/p3\n12: - $41.00. A slatted cedar tray that drains into a hidden reservoir.\n13: ### link "Linen Apron" [ref=e8] /product/p5\n14: - $18.00. A washed linen apron with two deep pockets and cross-back straps.\n15: ### link "Stoneware Mug" [ref=e9] /product/p6\n16: - $12.00. A speckled stoneware mug that holds 350 millilitres.\n17: ### link "Walnut Spice Rack" [ref=e10] /product/p7\n18: - $29.00. A three-tier walnut rack that holds eighteen standard jars.\n19: ### link "Oak Bread Bin" [ref=e11] /product/p8\n20: - $46.00. A roll-top oak bin that keeps two loaves fresh for four days.\n21: ### link "Wool Tea Cosy" [ref=e12] /product/p9\n22: - $16.00. A felted wool cosy that keeps a six-cup pot hot for an hour.\n23: Search to see the whole range.\n24: What customers say\n25: “The kettle has lived on our stove for three winters and still sings like the first morning.” — Maren, Tromsø\n26: “The board arrived oiled and ready, wrapped in paper with a note from the maker who cut it.” — Idris, Leeds\n27: “I ordered a mug for my father and the workshop wrote back to ask which glaze he would like.” — Paloma, Seville\n28: “The apron softened after one wash and the pockets hold a notebook, a pencil, and a phone.” — Kenji, Sapporo\n29: “Our cafe has used the trays for two years. Not one has warped, even on the terrace.” — Aoife, Galway\n30: “The spice rack fitted the gap beside the window exactly, and the walnut glows in the evening.” — Tomas, Brno\n31: “I asked how to restore an old board and the workshop sent a page of notes and a tin of wax.” — Lior, Haifa\n32: “Every parcel comes in paper and card, and the card goes straight into our recycling.” — Nadia, Casablanca\n33: “The kettle handle stays cool enough to hold without a cloth, which my hands appreciate.” — Rosa, Porto\n34: “The mug holds exactly one pot of tea, so nobody in our house argues about the last cup.” — Emeka, Enugu\n35: “We visited the workshop on the first Saturday and watched a kettle take shape in an hour.” — Sofie, Aarhus\n36: “The tea tray drains into its hidden reservoir, so the table stays dry through a long afternoon.” — Ravi, Pune\n37: “The board still looks new after a year of daily bread, onions, and one very sharp knife.” — Hanne, Bergen\n38: “A replacement for a chipped mug arrived within the week, and they did not ask for the old one.” — Dario, Turin\n39: “The copper has darkened to a warm brown, and I like it more each month it sits on the hob.” — Ines, Lisbon\n40: ## Our story\n41: Harbor Goods began as a market stall on the east pier, selling kettles and boards made by three families of makers who shared one workshop behind the fish market.\n42: Every piece we sell is made in small batches. The kettles are spun and hammered by hand, the boards are cut from trees that fell in winter storms, and the mugs are thrown and glazed in a kiln that runs twice a week.\n43: We test each kettle on gas, electric, and induction hobs before it leaves the workshop, and we oil each board three times over a week so that it arrives ready for a knife.\n44: We pack every order in paper and card from the recycling yard down the road. No plastic leaves our workshop, and every box can go straight into your own recycling bin.\n45: Gift wrapping is free on every order. Choose it at checkout and we will add a handwritten card with any message you like, up to forty words.\n[lines 1–45 of 52; 7 below; call read with from 46 for more]',
	},
	{
		record: 'validate-2/2b/C2/inputs/49171-paging.json',
		html: '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<link rel="icon" href="data:,">\n<title>Shipping policy</title>\n</head>\n<body>\n<header>\n<nav aria-label="Store">\n<a href="/">Catalogue</a>\n<a href="/cart">Cart</a>\n<a href="/checkout">Checkout</a>\n</nav>\n</header>\n<main>\n<article>\n<h1>Shipping policy</h1>\n<h2>Where we ship</h2>\n<p>We ship to every address in the country, including islands and remote postcodes. Parcels to the islands travel by ferry and can take one extra working day. We do not ship to parcel lockers, because a kettle box is too large for most of them.</p>\n<h2>How we pack</h2>\n<p>Every order is packed by hand in paper and card. Kettles travel in a moulded pulp cradle, boards travel wrapped in kraft paper, and mugs travel in a honeycomb sleeve that protects the glaze. We never use plastic fill.</p>\n<h2>Carriers</h2>\n<p>Standard parcels travel with the national post. Heavy parcels, over ten kilograms, travel with a courier who books a delivery window by text message. Both carriers give you a tracking link on the day your parcel leaves the workshop.</p>\n<h2>Delivery times</h2>\n<p>Standard delivery takes two to four working days on the mainland. Express delivery takes one working day on the mainland and two to the islands. Delivery times start from the day the parcel leaves the workshop, not from the day you order.</p>\n<h2>Delivery prices</h2>\n<p>Standard delivery is free on orders over sixty dollars and costs six dollars below that. Express delivery costs fourteen dollars on every order. Heavy parcels cost the same as standard parcels; the workshop pays the difference.</p>\n<h2>Signing for a parcel</h2>\n<p>Parcels worth more than one hundred dollars need a signature. If nobody is home, the carrier leaves a card and holds the parcel at the nearest depot for ten days. You can name a neighbour at checkout who can sign on your behalf.</p>\n<h2>Missed deliveries</h2>\n<p>If a parcel returns to us after ten days at the depot, we write to you and send it again once, free of charge. A parcel that returns a second time is refunded in full, minus the delivery price of the second attempt.</p>\n<h2>Damaged parcels</h2>\n<p>Open your parcel within seven days and check every piece. If anything is damaged, photograph it with the box and write to us. We send a replacement or refund the full price, and you keep the damaged piece; we never ask for it back.</p>\n<h2>Lost parcels</h2>\n<p>If tracking shows no movement for five working days, write to us. We open a claim with the carrier and send a replacement the same day, without waiting for the claim to finish. You do not need to contact the carrier yourself.</p>\n<h2>Changing an address</h2>\n<p>You can change the delivery address until the parcel leaves the workshop. After that, the carrier can redirect it for a fee that the carrier sets. Write to us with the order number and the new address and we will arrange it.</p>\n<h2>Gift orders</h2>\n<p>A gift order ships without a price list inside the box. Add the recipient address at checkout and your own address for the receipt. The handwritten card travels inside the box, sealed in its own envelope.</p>\n<h2>Orders from abroad</h2>\n<p>We do not ship abroad yet. Visitors from abroad can collect an order at the workshop on the first Saturday of each month; choose collection at checkout and bring the order number with you.</p>\n<h2>Collection</h2>\n<p>You can collect any order at the workshop on the east pier. Collection is free and the order is ready one working day after you place it. We hold a collection order for thirty days before we refund it.</p>\n<h2>Returns by post</h2>\n<p>To return an unwanted piece, write to us within thirty days. We send a prepaid label by email. Pack the piece in its original box if you still have it, and drop the parcel at any post office. We refund the full price when it reaches us.</p>\n<h2>Weather and holidays</h2>\n<p>During storms the ferry to the islands can stop for several days, and parcels wait at the harbour depot until it runs again. Between the last week of December and the first working day of January the workshop is closed and nothing ships.</p>\n<h2>Tracking your parcel</h2>\n<p>The tracking link arrives by email on the day the parcel leaves the workshop. It shows each scan the carrier records: collection, the sorting depot, the local depot, and the delivery van. A parcel can go a day without a scan while it travels between depots.</p>\n<h2>Delivery to a workplace</h2>\n<p>You can send an order to a workplace. Add the company name on the address line and the floor or department on the second line, so the post room can find you. Most post rooms sign for parcels, so a workplace delivery rarely misses.</p>\n<h2>Safe places</h2>\n<p>At checkout you can name a safe place, such as a porch or a shed, where the carrier may leave a parcel that needs no signature. The carrier photographs the parcel where it was left, and the photograph appears on the tracking page.</p>\n<h2>Split orders</h2>\n<p>When part of an order is waiting for a new batch, we ship the pieces that are ready and send the rest when the batch is finished. You pay delivery once, and each parcel carries its own tracking link.</p>\n<h2>Large and fragile pieces</h2>\n<p>Cake stands, serving platters, and shelving travel with the courier because they need two people to carry or careful handling. The courier books a delivery window with you by text message the day before.</p>\n<h2>Changing an order</h2>\n<p>You can add or remove pieces until the order is packed. Write to us with the order number and the change. When a change lowers the price, we refund the difference; when it raises the price, we send a payment link for the difference.</p>\n<h2>Cancelling an order</h2>\n<p>You can cancel an order at any time before it leaves the workshop, and we refund the full price the same day. After it leaves, the returns section applies, and the prepaid return label is still free.</p>\n<h2>Refund times</h2>\n<p>Refunds go back to the card or account you paid with. Most banks show a refund within three working days of the day we send it; some take up to ten. We write to you on the day we send each refund.</p>\n<h2>Customs and duties</h2>\n<p>Every order ships from and to an address in this country, so no customs forms or duties apply. When we begin to ship abroad, this section will state the duties each destination charges.</p>\n<h2>Contacting the workshop</h2>\n<p>Write to the workshop by email or through the contact form. We answer every message ourselves, usually within one working day. Include the order number when you have one, so we can find your order quickly.</p>\n<h2>Packing inspection</h2>\n<p>Before a parcel leaves the bench, a second packer checks the piece against the packing slip. They inspect handles, lids, edges, and glaze, and replace any wrapping that has shifted. The signed slip travels inside the box so a recipient can see who checked the contents.</p>\n<h2>Reused cartons</h2>\n<p>A clean carton from an incoming supply can carry an outgoing parcel when its walls remain firm. Old address labels are removed and seams receive fresh paper tape. A reused carton receives the same inspection and protection as a carton cut for the first time.</p>\n<h2>Combining parcels</h2>\n<p>Orders placed close together can travel in one box when their destinations agree. Write before packing begins and include both order numbers. Each piece stays on its own packing slip, and any delivery charge saved by combining the parcels goes back to the original payment.</p>\n<h2>Access instructions</h2>\n<p>A carrier needs a clear route to the entrance. Include gate instructions and a working contact number when you order. If a road closes after dispatch, contact the carrier through the tracking link to agree on an accessible meeting place or a later delivery day.</p>\n<h2>Opening the box</h2>\n<p>Set a parcel on a firm table before cutting the tape. Lift the paper layers apart instead of pulling on handles or rims. Keep the cradle until every piece has been checked, because the shaped supports make a return trip less likely to damage the contents.</p>\n<h2>Caring for wrapping</h2>\n<p>Paper sleeves can be flattened and kept for storing pieces between uses. Keep them dry and away from a cooker. Pulp cradles fit in paper recycling where that service accepts moulded paper, and the workshop can take clean cradles back during collection hours.</p>\n<h2>Parcel weights</h2>\n<p>The label states the packed weight, which includes the carton and its protective supports. It may differ from the weight listed for an individual piece. Heavy cartons carry a handling mark and remain within the limits agreed with the carrier for a safe lift.</p>\n<h2>Receipt copies</h2>\n<p>Keep the receipt until every piece has arrived and been checked. If an email goes missing, send the order number and the address used at checkout. The workshop can send another copy to that address without changing the contents or the date of the original receipt.</p>\n<h2>Seasonal packaging</h2>\n<p>During wet months each carton receives an extra folded paper liner. During hot months waxed boards are wrapped only after cooling on the shelf. These changes protect the pieces in transit and do not change the delivery price or the return period.</p>\n<h2>Handing over gifts</h2>\n<p>A recipient can request care notes without seeing the price paid for a gift. The packing slip names the piece and its maker. If a gift needs a replacement, either the sender or the recipient can contact the workshop with the number printed on that slip.</p>\n<h2>Depot collection documents</h2>\n<p>Take the delivery card and the identification the carrier requests when collecting from a depot. A person collecting on your behalf may need a signed note. Check the opening hours on the carrier notice before travelling, because depot hours differ from post office hours.</p>\n<h2>Parcel enquiries</h2>\n<p>Keep photographs and tracking notices together while an enquiry is open. The workshop records each reply with the order, so a later message can continue the same conversation. Tell the workshop when a delayed parcel arrives so the carrier can close its enquiry.</p>\n<h2>Quoting this version</h2>\n<p>Quote HARBOR-TIDE-7153 when you write to us, so our workshop can match a message to this version of these terms.</p>\n</article>\n</main>\n\n</body>\n</html>\n',
		expected:
			'page "Shipping policy" http://127.0.0.1:PORT/policy (80 lines)\nThis read shows lines 1–33 of 80; lines 34–80 are not shown yet.\n1: link "Catalogue" [ref=e1] /\n2: link "Cart" [ref=e2] /cart\n3: link "Checkout" [ref=e3] /checkout\n4: # Shipping policy\n5: ## Where we ship\n6: We ship to every address in the country, including islands and remote postcodes. Parcels to the islands travel by ferry and can take one extra working day. We do not ship to parcel lockers, because a kettle box is too large for most of them.\n7: ## How we pack\n8: Every order is packed by hand in paper and card. Kettles travel in a moulded pulp cradle, boards travel wrapped in kraft paper, and mugs travel in a honeycomb sleeve that protects the glaze. We never use plastic fill.\n9: ## Carriers\n10: Standard parcels travel with the national post. Heavy parcels, over ten kilograms, travel with a courier who books a delivery window by text message. Both carriers give you a tracking link on the day your parcel leaves the workshop.\n11: ## Delivery times\n12: Standard delivery takes two to four working days on the mainland. Express delivery takes one working day on the mainland and two to the islands. Delivery times start from the day the parcel leaves the workshop, not from the day you order.\n13: ## Delivery prices\n14: Standard delivery is free on orders over sixty dollars and costs six dollars below that. Express delivery costs fourteen dollars on every order. Heavy parcels cost the same as standard parcels; the workshop pays the difference.\n15: ## Signing for a parcel\n16: Parcels worth more than one hundred dollars need a signature. If nobody is home, the carrier leaves a card and holds the parcel at the nearest depot for ten days. You can name a neighbour at checkout who can sign on your behalf.\n17: ## Missed deliveries\n18: If a parcel returns to us after ten days at the depot, we write to you and send it again once, free of charge. A parcel that returns a second time is refunded in full, minus the delivery price of the second attempt.\n19: ## Damaged parcels\n20: Open your parcel within seven days and check every piece. If anything is damaged, photograph it with the box and write to us. We send a replacement or refund the full price, and you keep the damaged piece; we never ask for it back.\n21: ## Lost parcels\n22: If tracking shows no movement for five working days, write to us. We open a claim with the carrier and send a replacement the same day, without waiting for the claim to finish. You do not need to contact the carrier yourself.\n23: ## Changing an address\n24: You can change the delivery address until the parcel leaves the workshop. After that, the carrier can redirect it for a fee that the carrier sets. Write to us with the order number and the new address and we will arrange it.\n25: ## Gift orders\n26: A gift order ships without a price list inside the box. Add the recipient address at checkout and your own address for the receipt. The handwritten card travels inside the box, sealed in its own envelope.\n27: ## Orders from abroad\n28: We do not ship abroad yet. Visitors from abroad can collect an order at the workshop on the first Saturday of each month; choose collection at checkout and bring the order number with you.\n29: ## Collection\n30: You can collect any order at the workshop on the east pier. Collection is free and the order is ready one working day after you place it. We hold a collection order for thirty days before we refund it.\n31: ## Returns by post\n32: To return an unwanted piece, write to us within thirty days. We send a prepaid label by email. Pack the piece in its original box if you still have it, and drop the parcel at any post office. We refund the full price when it reaches us.\n33: ## Weather and holidays\n[lines 1–33 of 80; 47 below; call read with from 34 for more]',
	},
])
