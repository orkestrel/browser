import type {
	BrowserAction,
	BrowserCallOptions,
	BrowserElementManagerInterface,
	BrowserJourney,
	BrowserJourneyEdit,
	BrowserJourneyStepInput,
	BrowserJourneyTab,
	BrowserRun,
	BrowserToolsetInterface,
	BrowserElementQuery,
	BrowserOutline,
	BrowserOutlineNode,
	BrowserChord,
	BrowserCookie,
	BrowserCookieInput,
	BrowserContextOptions,
	BrowserCoverageRange,
	BrowserDocument,
	BrowserEmulationOptions,
	BrowserFrameInfo,
	BrowserFunctionCoverage,
	BrowserHAR,
	BrowserHAREntry,
	BrowserHARPending,
	BrowserHARValue,
	BrowserLayout,
	BrowserMetric,
	BrowserOperationOptions,
	BrowserAccessibilityOptions,
	BrowserAccessibilitySnapshot,
	BrowserAXNode,
	BrowserKey,
	BrowserNode,
	BrowserNodePredicate,
	BrowserNodeQuery,
	BrowserProfile,
	BrowserProfileFrame,
	BrowserProfileNode,
	BrowserMouseButton,
	BrowserPoint,
	BrowserPDFOptions,
	BrowserMedia,
	BrowserRequest,
	BrowserRouteQuery,
	BrowserQuad,
	BrowserReadResult,
	BrowserReceipt,
	BrowserElementInterface,
	BrowserSnapshotInput,
	BrowserScriptCoverage,
	BrowserScreenshotOptions,
	BrowserStorageEntry,
	BrowserStorageOrigin,
	BrowserStreamChunk,
	BrowserStackFrame,
	BrowserStyleCoverage,
	BrowserTeardownFunction,
	BrowserViewport,
} from './types.js'
import type { ToolContext, ToolDefinition } from '@orkestrel/tool'
import type { JSONValue } from '@orkestrel/contract'
import {
	attempt,
	isArray,
	isBoolean,
	isFiniteNumber,
	isFunction,
	isInteger,
	isRecord,
	isString,
	parseArray,
	parseEnum,
} from '@orkestrel/contract'
import {
	BROWSER_JOURNEY_ACTIONS,
	BROWSER_JOURNEY_PARAMETER_PATTERN,
	BASE64_CHARS,
	BROWSER_OUTLINE_OMITTED_ROLES,
	BASE64_LOOKUP,
	BROWSER_RESULT_LIMIT,
	BROWSER_REGISTRY_OUTPUT_LIMIT,
	BROWSER_RESULT_LIMIT_PATTERN,
	BROWSER_SNAPSHOT_NODE_LIMIT,
	BROWSER_KEY_MODIFIERS,
	BROWSER_MOUSE_BUTTON_MASKS,
} from './constants.js'
import {
	isBrowserJourneyBinding,
	validateBrowserJourney,
	validateBrowserJourneyEdit,
	validateBrowserJourneyStep,
} from './validators.js'
import { BrowserElementError, BrowserError, BrowserResultLimitError } from './errors.js'
import {
	parseBrowserAXString,
	parseBrowserCookiePartition,
	parseBrowserRect,
	parseBrowserReference,
	parseNumberArray,
	parseSnapshotString,
} from './parsers.js'

/**
 * Normalizes an accessible name for display and matching.
 * @param value - Accessible name
 * @returns Trimmed name with collapsed whitespace
 */
export function normalizeBrowserName(value: string): string {
	return value.trim().replace(/\s+/g, ' ')
}

/**
 * Filters document-order outline rows by accessibility role and name.
 * @param nodes - Captured rows
 * @param query - Role and name constraints, with whole, case-sensitive matching when exact is true
 * @returns Matching rows in their original order
 */
export function filterBrowserOutline(
	nodes: readonly BrowserOutlineNode[],
	query: BrowserElementQuery,
): readonly BrowserOutlineNode[] {
	return nodes.filter(
		(node) =>
			!node.ignored &&
			!BROWSER_OUTLINE_OMITTED_ROLES.has(node.role ?? '') &&
			(query.role === undefined || node.role === query.role) &&
			(query.name === undefined ||
				(query.exact === true
					? normalizeBrowserName(node.name ?? '') === normalizeBrowserName(query.name)
					: normalizeBrowserName(node.name ?? '')
							.toLowerCase()
							.includes(normalizeBrowserName(query.name).toLowerCase()))),
	)
}

/**
 * Renders document-order text and referenced elements with a bounded element count.
 * @param url - Document address
 * @param title - Document title
 * @param nodes - Ordered accessibility rows
 * @param limit - Maximum referenced rows to include
 * @returns Outline text and element counts
 */
export function renderBrowserOutline(
	url: string,
	title: string,
	nodes: readonly BrowserOutlineNode[],
	limit: number,
): BrowserOutline {
	const rows = [`page ${JSON.stringify(title)} ${url}`]
	let count = 0
	let total = 0
	for (const node of nodes) {
		if (node.ignored || BROWSER_OUTLINE_OMITTED_ROLES.has(node.role ?? '')) continue
		const name = normalizeBrowserName(node.name ?? '')
		if (node.role === 'heading') {
			rows.push(`# ${name}`)
			continue
		}
		if (node.role === 'StaticText') {
			const parent = nodes.find(
				(candidate) => candidate.session === node.session && candidate.id === node.parent,
			)
			if (name !== '' && name !== normalizeBrowserName(parent?.name ?? '')) rows.push(name)
			continue
		}
		if (node.reference === undefined) continue
		total += 1
		if (count >= limit) continue
		count += 1
		let row = `${node.reference} ${node.role ?? 'unknown'} ${JSON.stringify(name)}`
		if (node.value !== undefined && node.value !== '')
			row += ` value=${JSON.stringify(String(node.value))}`
		if (node.properties['checked'] === true || node.properties['checked'] === 'true')
			row += ' [checked]'
		if (node.properties['disabled'] === true) row += ' [disabled]'
		if (node.tool !== undefined) row += ` [tool=${node.tool}]`
		rows.push(row)
	}
	rows.push(`(${count} of ${total} elements)`)
	return { url, title, text: rows.join('\n'), count, total }
}

/**
 * Composes a frame-local point with its ancestor frame offsets.
 * @param point - Local point
 * @param offsets - Frame rectangles' origins, ordered from child to parent
 * @returns Validated page point
 */
export function composeBrowserPoint(
	point: BrowserPoint,
	offsets: readonly BrowserPoint[],
): BrowserPoint {
	validateBrowserPoint(point)
	let x = point.x
	let y = point.y
	for (const offset of offsets) {
		validateBrowserPoint(offset)
		x += offset.x
		y += offset.y
	}
	const result = { x, y }
	validateBrowserPoint(result)
	return result
}

/**
 * Normalizes named keys and modifier aliases before trusted keyboard input.
 * @param value - Key or modifier chord
 * @returns Canonical key chord
 * @throws Thrown when a key or modifier is unsupported, listing accepted names.
 */
export function normalizeBrowserKey(value: string): string {
	const accepted = [
		'Backspace',
		'Tab',
		'Enter',
		'Shift',
		'Control',
		'Alt',
		'Escape',
		'Space',
		'PageUp',
		'PageDown',
		'End',
		'Home',
		'ArrowLeft',
		'ArrowUp',
		'ArrowRight',
		'ArrowDown',
		'Delete',
		'Meta',
	]
	const aliases: Readonly<Record<string, string>> = {
		return: 'Enter',
		esc: 'Escape',
		ctrl: 'Control',
		cmd: 'Meta',
		command: 'Meta',
	}
	const parts = value.split('+')
	const normalized = parts.map(
		(part) =>
			aliases[part.toLowerCase()] ??
			accepted.find((name) => name.toLowerCase() === part.toLowerCase()) ??
			part,
	)
	try {
		const chord = extractBrowserChord(normalized.join('+'))
		keyToBrowserInput(chord.key)
		if (parts.some((part) => part === '')) throw new BrowserError('Empty key')
		return normalized.join('+')
	} catch {
		throw new BrowserError(
			`Unknown browser key ${JSON.stringify(value)}. Accepted names: ${accepted.join(', ')}, a single character, and modifier chords such as Control+a.`,
		)
	}
}

/**
 * Renders tool strings unchanged, content-array text blocks joined, and other values as bounded JSON.
 * @param value - Untrusted tool output
 * @returns Rendered output; non-serializable values receive a bounded diagnostic
 */
export function renderBrowserToolOutput(value: unknown): string {
	if (isString(value)) return value
	if (isArray(value) && value.every((block) => isRecord(block) && isString(block['type']))) {
		return value
			.filter(isRecord)
			.filter((block) => block['type'] === 'text' && isString(block['text']))
			.map((block) => block['text'])
			.join('\n')
	}
	const rendered = attempt(() => JSON.stringify(value))
	return (
		rendered.success ? (rendered.value ?? String(value)) : '[Unserializable tool output]'
	).slice(0, BROWSER_REGISTRY_OUTPUT_LIMIT)
}

/**
 * Derives the advertised input schema from an authored one, adding a required `what` parameter when the schema requires nothing.
 * @param schema - Authored input schema, or undefined for a parameterless tool
 * @returns An advertised schema, or undefined when the authored `what` parameter is optional
 * @remarks The caller strips only a synthetic `what` parameter before invoking the page tool.
 */
export function deriveBrowserToolSchema(
	schema: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
	const properties = isRecord(schema?.['properties']) ? schema['properties'] : {}
	const required = isArray(schema?.['required']) ? schema['required'].filter(isString) : []
	if (Object.hasOwn(properties, 'what') && !required.includes('what')) return undefined
	if (required.length > 0) return schema
	return {
		...schema,
		type: 'object',
		properties: {
			...properties,
			what: { type: 'string', description: 'Describe the purpose of this action.' },
		},
		required: ['what'],
	}
}

/**
 * Bounds a tool string at a character limit, appending a footer that names the cut and the
 * caller's closing clause.
 *
 * @remarks
 * A string within the limit returns unchanged. A longer one keeps its first `limit` UTF-16 code
 * units, one fewer when the last would split a surrogate pair (so a limit of 1 before a pair keeps
 * nothing), followed by `\n[characters 0–END of TOTAL; FOOTER]`. The footer has no default, so
 * every caller states what the cut result's reader does next: the toolset passes
 * `BROWSER_TOOL_VIEW_FOOTER` for a result that carries a view and `BROWSER_TOOL_CUT_FOOTER` for
 * any other.
 *
 * @param text - The page-authored or composed string
 * @param limit - The most characters kept before the footer, a positive integer
 * @param footer - The clause that closes the footer after the character range
 * @returns The string, cut and footed when it exceeds the limit
 * @throws Thrown when `limit` is not a positive integer.
 *
 * @example
 * ```ts
 * import { boundBrowserText } from '@orkestrel/browser'
 *
 * boundBrowserText('abcdef', 4, 'the rest was cut') // 'abcd\n[characters 0–4 of 6; the rest was cut]'
 * boundBrowserText('abc', 4, 'the rest was cut') // 'abc'
 * ```
 */
export function boundBrowserText(text: string, limit: number, footer: string): string {
	if (!isInteger(limit) || limit < 1) {
		throw new BrowserError('Browser tool limit must be a positive integer', undefined, { limit })
	}
	if (text.length <= limit) return text
	const last = text.charCodeAt(limit - 1)
	const end = last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit
	return `${text.slice(0, end)}\n[characters 0–${end} of ${text.length}; ${footer}]`
}

/**
 * Refuses a tool call that carries a parameter its definition does not advertise, naming the
 * parameters the tool takes.
 *
 * @param definition - The advertised tool definition whose `parameters.properties` names the
 * accepted keys
 * @param args - The arguments a model supplied
 * @throws Thrown as a `BrowserError` coded `BROWSER_TOOLSET_ARGUMENT`, with the refused key in its
 * context, when an argument key is not an advertised parameter.
 *
 * @example
 * ```ts
 * import { BROWSER_TOOL_COPY, validateBrowserToolArguments } from '@orkestrel/browser'
 *
 * validateBrowserToolArguments(BROWSER_TOOL_COPY.look, { what: 'cart', ref: 'e1' })
 * // throws 'The look tool takes no ref parameter; call look with what.'
 * ```
 */
export function validateBrowserToolArguments(
	definition: ToolDefinition,
	args: Readonly<Record<string, unknown>>,
): void {
	const properties = definition.parameters?.['properties']
	const keys = isRecord(properties) ? Object.keys(properties) : []
	const key = Object.keys(args).find((candidate) => !keys.includes(candidate))
	if (key === undefined) return
	const accepted = new Intl.ListFormat('en', { type: 'conjunction' }).format(keys)
	throw new BrowserError(
		`The ${definition.name} tool takes no ${key} parameter; call ${definition.name} with ${accepted}.`,
		'BROWSER_TOOLSET_ARGUMENT',
		{ key },
	)
}

/**
 * Renders an element as its outline row reads: reference, role, and quoted name.
 *
 * @param element - The referenced element
 * @returns The element's reference, role, and JSON-quoted name
 *
 * @example
 * ```ts
 * import { renderBrowserElement } from '@orkestrel/browser'
 *
 * const element = page.elements.element('e4')
 * if (element !== undefined) renderBrowserElement(element) // 'e4 button "Place order"'
 * ```
 */
export function renderBrowserElement(element: BrowserElementInterface): string {
	return `${element.reference} ${element.role} ${JSON.stringify(element.name)}`
}

/**
 * Requires a tool argument to be an element reference in any spelling `parseBrowserReference`
 * accepts, and returns its canonical form.
 *
 * @param value - The argument a model supplied
 * @returns The canonical reference, such as `e12`
 * @throws Thrown as a `BrowserElementError` with reason `UNKNOWN` when the value is not a
 * reference, naming `look` as the next call.
 *
 * @example
 * ```ts
 * import { requireBrowserReference } from '@orkestrel/browser'
 *
 * requireBrowserReference('[ref=e12]') // 'e12'
 * ```
 */
export function requireBrowserReference(value: unknown): string {
	const reference = isString(value) ? parseBrowserReference(value) : undefined
	if (reference === undefined)
		throw new BrowserElementError(
			{ subject: `Reference ${JSON.stringify(value)}` },
			'UNKNOWN',
			'is not a reference such as e12; call look for fresh refs',
		)
	return reference
}

/**
 * Reads a required string argument from a tool call.
 *
 * @param args - The arguments a model supplied
 * @param key - The parameter name
 * @returns The string the argument holds
 * @throws Thrown as a `BrowserError` coded `BROWSER_TOOLSET_ARGUMENT` when the argument is not a
 * string.
 *
 * @example
 * ```ts
 * import { readBrowserToolString } from '@orkestrel/browser'
 *
 * readBrowserToolString({ url: 'https://example.com/' }, 'url') // 'https://example.com/'
 * ```
 */
export function readBrowserToolString(
	args: Readonly<Record<string, unknown>>,
	key: string,
): string {
	const value = args[key]
	if (!isString(value))
		throw new BrowserError(`The ${key} parameter must be a string.`, 'BROWSER_TOOLSET_ARGUMENT', {
			key,
		})
	return value
}

/**
 * Renders a tool receipt: the action and its status on one line, the interrupting dialog, then
 * a blank line and the fresh view.
 *
 * @remarks
 * The status joins the action with a semicolon, and a period closes the line. A dialog adds
 * `A CATEGORY dialog is open: "MESSAGE"; call dialog.`, with `An` before `alert`. An empty
 * action with no status leaves the dialog sentence, or the view, alone. A `trusted` of `false`
 * ends the line with ` (untrusted event)`.
 *
 * @param receipt - The action, status, dialog, and view
 * @returns The receipt text
 *
 * @example
 * ```ts
 * import { renderBrowserReceipt } from '@orkestrel/browser'
 *
 * renderBrowserReceipt({
 * 	action: 'Clicked e7 button "Delete"',
 * 	dialog: { category: 'confirm', message: 'Delete the draft?' },
 * })
 * // 'Clicked e7 button "Delete". A confirm dialog is open: "Delete the draft?"; call dialog.'
 * ```
 */
export function renderBrowserReceipt(receipt: BrowserReceipt): string {
	const sentences: string[] = []
	if (receipt.action !== '' || receipt.status !== undefined)
		sentences.push(
			`${[receipt.action, receipt.status].filter((part) => part !== undefined && part !== '').join('; ')}.`,
		)
	if (receipt.dialog !== undefined)
		sentences.push(
			`${receipt.dialog.category === 'alert' ? 'An' : 'A'} ${receipt.dialog.category} dialog is open: ${JSON.stringify(receipt.dialog.message)}; call dialog.`,
		)
	const line = `${sentences.join(' ')}${receipt.trusted === false ? ' (untrusted event)' : ''}`
	if (receipt.view === undefined) return line
	return line === '' ? receipt.view : `${line}\n\n${receipt.view}`
}

/**
 * Decodes a base64-encoded string into raw bytes.
 *
 * @remarks
 * Pure JS implementation — no `Buffer`, no `atob` (DOM-only) — so it runs
 * identically in Node and browser environments. Whitespace and `=` padding
 * are ignored; invalid characters are skipped.
 *
 * @param text - Base64-encoded input string
 * @returns Decoded bytes
 *
 * @example
 * ```ts
 * decodeBase64('aGVsbG8=') // Uint8Array [104, 101, 108, 108, 111]
 * ```
 */
export function decodeBase64(text: string): Uint8Array {
	const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
	const bytes: number[] = []

	let buffer = 0
	let bits = 0

	for (const char of clean) {
		const value = BASE64_LOOKUP[char]
		if (value === undefined) continue

		buffer = (buffer << 6) | value
		bits += 6

		if (bits >= 8) {
			bits -= 8
			bytes.push((buffer >> bits) & 0xff)
		}
	}

	return new Uint8Array(bytes)
}

/**
 * Encodes raw bytes as base64 without relying on Node or DOM globals.
 *
 * @param bytes - Raw input bytes
 * @returns Base64 text
 */
export function encodeBase64(bytes: Uint8Array): string {
	let result = ''
	for (let index = 0; index < bytes.length; index += 3) {
		const first = bytes[index]
		const second = bytes[index + 1]
		const third = bytes[index + 2]
		if (first === undefined) break
		const value = (first << 16) | ((second ?? 0) << 8) | (third ?? 0)
		result += BASE64_CHARS[(value >> 18) & 63] ?? ''
		result += BASE64_CHARS[(value >> 12) & 63] ?? ''
		result += second === undefined ? '=' : (BASE64_CHARS[(value >> 6) & 63] ?? '')
		result += third === undefined ? '=' : (BASE64_CHARS[value & 63] ?? '')
	}
	return result
}

/** Encodes UTF-8 text as bytes. */
export function textToBytes(value: string): Uint8Array {
	return new TextEncoder().encode(value)
}

/** Decodes UTF-8 bytes as text. */
export function bytesToText(value: Uint8Array): string {
	return new TextDecoder().decode(value)
}

/**
 * Converts a header record to Fetch-domain name/value entries.
 *
 * @param headers - Header record
 * @returns Protocol header entries
 */
export function browserHeadersToProtocol(
	headers: Readonly<Record<string, string>>,
): ReadonlyArray<Readonly<Record<string, string>>> {
	return Object.entries(headers).map(([name, value]) => ({ name, value }))
}

/**
 * Decodes a Chromium Headers object into string values, skipping every entry that is neither a
 * string nor a finite number.
 *
 * @param value - Unknown headers
 * @returns Frozen-compatible header record
 */
export function readBrowserHeaders(value: unknown): Readonly<Record<string, string>> {
	if (!isRecord(value)) return {}
	const headers: Record<string, string> = {}
	for (const [name, entry] of Object.entries(value)) {
		if (isString(entry) || isFiniteNumber(entry)) headers[name] = String(entry)
	}
	return headers
}

/**
 * Builds a standards-shaped HAR 1.2 entry from one observed exchange.
 *
 * @param pending - Request and optional response captured by the recorder
 * @param duration - Whole exchange duration in milliseconds
 * @param body - Optional decoded response body
 * @param error - Optional request failure description
 * @returns HAR 1.2 entry
 */
export function createBrowserHAREntry(
	pending: BrowserHARPending,
	duration: number,
	body?: Uint8Array,
	error?: string,
): BrowserHAREntry {
	const response = pending.response
	const requestHeaders: BrowserHARValue[] = Object.entries(pending.request.headers).map(
		([name, value]) => ({ name, value }),
	)
	const responseHeaders: BrowserHARValue[] =
		response === undefined
			? []
			: Object.entries(response.headers).map(([name, value]) => ({ name, value }))
	const query: BrowserHARValue[] = []
	if (URL.canParse(pending.request.url)) {
		for (const [name, value] of new URL(pending.request.url).searchParams) {
			query.push({ name, value })
		}
	}
	const post = pending.request.post
	const requestMime =
		Object.entries(pending.request.headers).find(
			([name]) => name.toLowerCase() === 'content-type',
		)?.[1] ?? 'application/octet-stream'
	const redirect =
		response === undefined
			? ''
			: (Object.entries(response.headers).find(
					([name]) => name.toLowerCase() === 'location',
				)?.[1] ?? '')
	const timing = response?.timing
	const dns = timing?.dns === undefined ? -1 : Math.max(0, timing.dns.end - timing.dns.start)
	const connect =
		timing?.connect === undefined ? -1 : Math.max(0, timing.connect.end - timing.connect.start)
	const send = timing?.send === undefined ? 0 : Math.max(0, timing.send.end - timing.send.start)
	const wait =
		timing?.receive === undefined
			? Math.max(0, duration)
			: Math.max(0, timing.receive - (timing.send?.end ?? 0))
	const ssl = timing?.ssl === undefined ? -1 : Math.max(0, timing.ssl.end - timing.ssl.start)
	const text = body === undefined ? undefined : encodeBase64(body)
	const size = body?.byteLength ?? (response === undefined ? 0 : -1)

	return {
		startedDateTime: new Date(pending.started).toISOString(),
		time: Math.max(0, duration),
		request: {
			method: pending.request.method,
			url: pending.request.url,
			httpVersion: response?.protocol ?? 'HTTP/0.0',
			cookies: [],
			headers: requestHeaders,
			queryString: query,
			...(post !== undefined
				? {
						postData: {
							mimeType: requestMime,
							text: post,
						},
					}
				: {}),
			headersSize: -1,
			bodySize: post === undefined ? 0 : textToBytes(post).byteLength,
		},
		response: {
			status: response?.status ?? 0,
			statusText: response?.phrase ?? error ?? 'Request failed',
			httpVersion: response?.protocol ?? 'HTTP/0.0',
			cookies: [],
			headers: responseHeaders,
			content: {
				size,
				mimeType: response?.mime ?? 'application/octet-stream',
				...(text !== undefined ? { text, encoding: 'base64' } : {}),
			},
			redirectURL: redirect,
			headersSize: -1,
			bodySize: size,
		},
		cache: {},
		timings: {
			blocked: -1,
			dns,
			connect,
			send,
			wait,
			receive: Math.max(0, duration - wait - send),
			ssl,
		},
	}
}

/**
 * Converts HAR name/value headers into a Fetch-domain header record.
 *
 * @param headers - HAR header entries
 * @returns Header record with later duplicate names replacing earlier values
 */
export function browserHARHeadersToRecord(
	headers: readonly BrowserHARValue[],
): Readonly<Record<string, string>> {
	const result: Record<string, string> = {}
	for (const header of headers) {
		Object.defineProperty(result, header.name, {
			value: header.value,
			enumerable: true,
			configurable: true,
			writable: true,
		})
	}
	return result
}

/**
 * Validates the HAR 1.2 fields required for deterministic replay.
 *
 * @param value - Candidate archive
 */
export function validateBrowserHAR(value: unknown): asserts value is BrowserHAR {
	if (
		!isRecord(value) ||
		!isRecord(value['log']) ||
		value['log']['version'] !== '1.2' ||
		!isRecord(value['log']['creator']) ||
		!isString(value['log']['creator']['name']) ||
		!isString(value['log']['creator']['version']) ||
		!isArray(value['log']['entries'])
	) {
		throw new BrowserError('Browser HAR document is malformed')
	}
	for (const [index, entry] of value['log']['entries'].entries()) {
		if (
			!isRecord(entry) ||
			!isString(entry['startedDateTime']) ||
			!isFiniteNumber(Date.parse(entry['startedDateTime'])) ||
			!isFiniteNumber(entry['time']) ||
			entry['time'] < 0 ||
			!isRecord(entry['request']) ||
			!isString(entry['request']['url']) ||
			!URL.canParse(entry['request']['url']) ||
			!isString(entry['request']['method']) ||
			!isString(entry['request']['httpVersion']) ||
			!isArray(entry['request']['cookies']) ||
			!isArray(entry['request']['headers']) ||
			!isArray(entry['request']['queryString']) ||
			!isInteger(entry['request']['headersSize']) ||
			entry['request']['headersSize'] < -1 ||
			!isInteger(entry['request']['bodySize']) ||
			entry['request']['bodySize'] < -1 ||
			!isRecord(entry['response']) ||
			!isInteger(entry['response']['status']) ||
			entry['response']['status'] < 0 ||
			entry['response']['status'] > 999 ||
			!isString(entry['response']['statusText']) ||
			!isString(entry['response']['httpVersion']) ||
			!isArray(entry['response']['cookies']) ||
			!isArray(entry['response']['headers']) ||
			!isRecord(entry['response']['content']) ||
			!isString(entry['response']['redirectURL']) ||
			!isInteger(entry['response']['headersSize']) ||
			entry['response']['headersSize'] < -1 ||
			!isInteger(entry['response']['bodySize']) ||
			entry['response']['bodySize'] < -1 ||
			!isRecord(entry['cache']) ||
			!isRecord(entry['timings'])
		) {
			throw new BrowserError('Browser HAR entry is malformed', undefined, { index })
		}
		for (const [cookieIndex, cookie] of entry['request']['cookies'].entries()) {
			if (
				!isRecord(cookie) ||
				!isString(cookie['name']) ||
				!isString(cookie['value']) ||
				(cookie['path'] !== undefined && !isString(cookie['path'])) ||
				(cookie['domain'] !== undefined && !isString(cookie['domain'])) ||
				(cookie['expires'] !== undefined && !isString(cookie['expires'])) ||
				(cookie['httpOnly'] !== undefined && !isBoolean(cookie['httpOnly'])) ||
				(cookie['secure'] !== undefined && !isBoolean(cookie['secure']))
			) {
				throw new BrowserError('Browser HAR request cookie is malformed', undefined, {
					index,
					cookie: cookieIndex,
				})
			}
		}
		for (const [headerIndex, header] of entry['request']['headers'].entries()) {
			if (!isRecord(header) || !isString(header['name']) || !isString(header['value'])) {
				throw new BrowserError('Browser HAR request header is malformed', undefined, {
					index,
					header: headerIndex,
				})
			}
		}
		for (const [queryIndex, query] of entry['request']['queryString'].entries()) {
			if (!isRecord(query) || !isString(query['name']) || !isString(query['value'])) {
				throw new BrowserError('Browser HAR query value is malformed', undefined, {
					index,
					query: queryIndex,
				})
			}
		}
		const post = entry['request']['postData']
		if (
			post !== undefined &&
			(!isRecord(post) || !isString(post['mimeType']) || !isString(post['text']))
		) {
			throw new BrowserError('Browser HAR request body is malformed', undefined, { index })
		}
		for (const [cookieIndex, cookie] of entry['response']['cookies'].entries()) {
			if (
				!isRecord(cookie) ||
				!isString(cookie['name']) ||
				!isString(cookie['value']) ||
				(cookie['path'] !== undefined && !isString(cookie['path'])) ||
				(cookie['domain'] !== undefined && !isString(cookie['domain'])) ||
				(cookie['expires'] !== undefined && !isString(cookie['expires'])) ||
				(cookie['httpOnly'] !== undefined && !isBoolean(cookie['httpOnly'])) ||
				(cookie['secure'] !== undefined && !isBoolean(cookie['secure']))
			) {
				throw new BrowserError('Browser HAR response cookie is malformed', undefined, {
					index,
					cookie: cookieIndex,
				})
			}
		}
		for (const [headerIndex, header] of entry['response']['headers'].entries()) {
			if (!isRecord(header) || !isString(header['name']) || !isString(header['value'])) {
				throw new BrowserError('Browser HAR response header is malformed', undefined, {
					index,
					header: headerIndex,
				})
			}
		}
		const text = entry['response']['content']['text']
		const encoding = entry['response']['content']['encoding']
		if (
			!isInteger(entry['response']['content']['size']) ||
			entry['response']['content']['size'] < -1 ||
			!isString(entry['response']['content']['mimeType']) ||
			(text !== undefined && !isString(text)) ||
			(encoding !== undefined && encoding !== 'base64') ||
			(encoding === 'base64' &&
				(text === undefined ||
					!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)))
		) {
			throw new BrowserError('Browser HAR response content is malformed', undefined, { index })
		}
		for (const name of ['blocked', 'dns', 'connect', 'send', 'wait', 'receive', 'ssl']) {
			const timing = entry['timings'][name]
			if (!isFiniteNumber(timing) || timing < -1) {
				throw new BrowserError('Browser HAR timing is malformed', undefined, {
					index,
					timing: name,
				})
			}
		}
	}
}

/**
 * Matches a request against route criteria.
 *
 * @param request - Observed request
 * @param query - Match criteria
 * @returns True if every supplied criterion matches; false otherwise
 */
export function matchesBrowserRoute(request: BrowserRequest, query: BrowserRouteQuery): boolean {
	if (query.method !== undefined && request.method !== query.method) return false
	if (query.resource !== undefined && request.resource !== query.resource) return false
	if (query.url === undefined) return true
	return matchesBrowserURL(request.url, query.url)
}

/**
 * Matches a URL using Chromium-style `*` and `**` glob segments.
 *
 * @param url - Candidate URL
 * @param pattern - Glob pattern
 * @returns True if the whole URL matches; false otherwise
 */
export function matchesBrowserURL(url: string, pattern: string): boolean {
	const source = pattern
		.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*/g, '[[DOUBLE_STAR]]')
		.replace(/\*/g, '[^/]*')
		.replace(/\[\[DOUBLE_STAR\]\]/g, '.*')
	return new RegExp(`^${source}$`).test(url)
}

/**
 * Decodes the `Page.addScriptToEvaluateOnNewDocument` result, throwing a `BrowserError`
 * off-shape.
 *
 * @param value - Unknown protocol result
 * @returns Script identifier
 */
export function readBrowserScriptIdentifier(value: unknown): string {
	if (!isRecord(value) || !isString(value['identifier'])) {
		throw new BrowserError('Browser init script identifier is malformed')
	}
	return value['identifier']
}

/**
 * Validates viewport input coordinates.
 *
 * @param point - Candidate point
 */
export function validateBrowserPoint(point: BrowserPoint): void {
	if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
		throw new BrowserError('Browser input coordinates must be finite', undefined, { point })
	}
}

/**
 * Validates the bounded delay, count, and steps of one trusted-input operation.
 *
 * @remarks
 * The parameter is `BrowserOperationOptions`, so one validator answers for a
 * mouse click, a mouse drag, and keyboard entry alike.
 *
 * @param options - Candidate input options
 */
export function validateBrowserInputOptions(options?: BrowserOperationOptions): void {
	if (options?.delay !== undefined && (!isFiniteNumber(options.delay) || options.delay < 0)) {
		throw new BrowserError('Browser input delay must be non-negative and finite', undefined, {
			delay: options.delay,
		})
	}
	if (options?.count !== undefined && (!isInteger(options.count) || options.count <= 0)) {
		throw new BrowserError('Browser click count must be a positive integer', undefined, {
			count: options.count,
		})
	}
	if (options?.steps !== undefined && (!isInteger(options.steps) || options.steps <= 0)) {
		throw new BrowserError('Browser drag steps must be a positive integer', undefined, {
			steps: options.steps,
		})
	}
}

/**
 * Validates a public browser timeout before protocol work begins.
 *
 * @param timeout - Timeout in milliseconds
 */
export function validateBrowserTimeout(timeout: number): void {
	if (!isFiniteNumber(timeout) || timeout < 0) {
		throw new BrowserError('Browser timeout must be a non-negative finite number', undefined, {
			timeout,
		})
	}
}

/**
 * Validates Chromium viewport metrics.
 *
 * @param viewport - Public viewport configuration
 */
export function validateBrowserViewport(viewport: BrowserViewport): void {
	if (
		!isInteger(viewport.width) ||
		viewport.width <= 0 ||
		!isInteger(viewport.height) ||
		viewport.height <= 0
	) {
		throw new BrowserError('Browser viewport dimensions must be positive integers', undefined, {
			viewport,
		})
	}
	if (viewport.scale !== undefined && (!isFiniteNumber(viewport.scale) || viewport.scale <= 0)) {
		throw new BrowserError('Browser viewport scale must be positive and finite', undefined, {
			scale: viewport.scale,
		})
	}
}

/**
 * Validates context emulation boundaries before partial application.
 *
 * @param options - Public emulation configuration
 */
export function validateBrowserEmulationOptions(options: BrowserEmulationOptions): void {
	if (options.viewport !== undefined) validateBrowserViewport(options.viewport)
	if (options.user !== undefined && options.user.value.length === 0) {
		throw new BrowserError('Browser user agent cannot be empty')
	}
	if (options.locale !== undefined && options.locale.length === 0) {
		throw new BrowserError('Browser locale cannot be empty')
	}
	if (options.timezone !== undefined && options.timezone.length === 0) {
		throw new BrowserError('Browser timezone cannot be empty')
	}
	if (options.geolocation !== undefined) {
		const location = options.geolocation
		if (
			!isFiniteNumber(location.latitude) ||
			location.latitude < -90 ||
			location.latitude > 90 ||
			!isFiniteNumber(location.longitude) ||
			location.longitude < -180 ||
			location.longitude > 180 ||
			(location.accuracy !== undefined &&
				(!isFiniteNumber(location.accuracy) || location.accuracy < 0))
		) {
			throw new BrowserError('Browser geolocation is outside valid coordinate bounds', undefined, {
				location,
			})
		}
	}
	for (const name of Object.keys(options.headers ?? {})) {
		if (name.length === 0) throw new BrowserError('Browser header name cannot be empty')
	}
}

/**
 * Validates isolated-context options before creating remote state.
 *
 * @param options - Public context configuration
 */
export function validateBrowserContextOptions(options?: BrowserContextOptions): void {
	if (options === undefined) return
	if (options.emulation !== undefined) validateBrowserEmulationOptions(options.emulation)
	if (options.proxy !== undefined) {
		if (options.proxy.server.length === 0) {
			throw new BrowserError('Browser proxy server cannot be empty')
		}
		if (options.proxy.bypass?.some((entry) => entry.length === 0) === true) {
			throw new BrowserError('Browser proxy bypass entries cannot be empty')
		}
	}
	for (const origin of options.origins ?? []) {
		const result = attempt(() => new URL(origin))
		if (!result.success) {
			throw new BrowserError('Browser context origin must be valid', undefined, { origin })
		}
		const url = result.value
		if (
			(url.protocol !== 'http:' && url.protocol !== 'https:') ||
			url.origin !== origin.replace(/\/$/, '')
		) {
			throw new BrowserError(
				'Browser context origin must be an absolute HTTP(S) origin',
				undefined,
				{
					origin,
				},
			)
		}
	}
	if (options.downloads !== undefined && options.downloads.path.length === 0) {
		throw new BrowserError('Browser download path cannot be empty')
	}
}

/**
 * Validates Accessibility-domain snapshot bounds.
 *
 * @param options - Public accessibility snapshot options
 */
export function validateBrowserAccessibilityOptions(options?: BrowserAccessibilityOptions): void {
	if (options?.root !== undefined && (!isInteger(options.root) || options.root <= 0)) {
		throw new BrowserError('Browser accessibility root must be a positive integer', undefined, {
			root: options.root,
		})
	}
	if (options?.depth !== undefined && (!isInteger(options.depth) || options.depth < 0)) {
		throw new BrowserError(
			'Browser accessibility depth must be a non-negative integer',
			undefined,
			{ depth: options.depth },
		)
	}
}

/**
 * Validates and compiles Page.printToPDF parameters.
 *
 * @param options - Public PDF options
 * @returns Protocol parameter record
 */
export function browserPDFToParams(options?: BrowserPDFOptions): Readonly<Record<string, unknown>> {
	const params: Record<string, unknown> = {
		landscape: options?.landscape ?? false,
		printBackground: options?.background ?? false,
		displayHeaderFooter: options?.header !== undefined || options?.footer !== undefined,
		generateTaggedPDF: options?.tagged ?? false,
		generateDocumentOutline: options?.outline ?? false,
	}
	if (options?.scale !== undefined) {
		validateBrowserRange(options.scale, 'PDF scale', 0.1, 2)
		params['scale'] = options.scale
	}
	if (options?.width !== undefined) {
		validateBrowserRange(options.width, 'PDF width', 0, Number.MAX_VALUE, false)
		params['paperWidth'] = options.width
	}
	if (options?.height !== undefined) {
		validateBrowserRange(options.height, 'PDF height', 0, Number.MAX_VALUE, false)
		params['paperHeight'] = options.height
	}
	if (options?.ranges !== undefined) params['pageRanges'] = options.ranges
	if (options?.header !== undefined) params['headerTemplate'] = options.header
	if (options?.footer !== undefined) params['footerTemplate'] = options.footer
	for (const [name, value] of Object.entries(options?.margin ?? {})) {
		if (!isFiniteNumber(value)) continue
		validateBrowserRange(value, `PDF ${name} margin`, 0, Number.MAX_VALUE)
		params[`margin${name[0]?.toUpperCase()}${name.slice(1)}`] = value
	}
	return params
}

/**
 * Validates and compiles basic Page.captureScreenshot parameters.
 *
 * @param options - Public screenshot options
 * @returns Protocol parameter record
 */
export function browserScreenshotToParams(
	options?: BrowserScreenshotOptions,
): Readonly<Record<string, unknown>> {
	const format = options?.format ?? 'png'
	if (options?.quality !== undefined) {
		if (format !== 'jpeg') {
			throw new BrowserError('Browser screenshot quality is only valid for JPEG')
		}
		if (!isInteger(options.quality) || options.quality < 0 || options.quality > 100) {
			throw new BrowserError('Browser screenshot quality must be an integer from 0 to 100')
		}
	}
	if (options?.full === true && options.clip !== undefined) {
		throw new BrowserError('Browser screenshot cannot combine full-page and clip capture')
	}
	const params: Record<string, unknown> = {
		format,
		fromSurface: true,
	}
	if (options?.quality !== undefined) params['quality'] = options.quality
	if (options?.clip !== undefined) {
		const [x, y, width, height] = options.clip
		validateBrowserRange(x, 'Screenshot clip x', -Number.MAX_VALUE, Number.MAX_VALUE)
		validateBrowserRange(y, 'Screenshot clip y', -Number.MAX_VALUE, Number.MAX_VALUE)
		validateBrowserRange(width, 'Screenshot clip width', 0, Number.MAX_VALUE, false)
		validateBrowserRange(height, 'Screenshot clip height', 0, Number.MAX_VALUE, false)
		params['clip'] = { x, y, width, height, scale: 1 }
		params['captureBeyondViewport'] = true
	}
	return params
}

/**
 * Validates a finite numeric range.
 *
 * @param value - Candidate number
 * @param field - Diagnostic field
 * @param minimum - Inclusive lower bound
 * @param maximum - Inclusive upper bound
 * @param inclusive - Whether the lower bound is inclusive
 */
export function validateBrowserRange(
	value: number,
	field: string,
	minimum: number,
	maximum: number,
	inclusive = true,
): void {
	if (
		!isFiniteNumber(value) ||
		(inclusive ? value < minimum : value <= minimum) ||
		value > maximum
	) {
		throw new BrowserError(`${field} is outside its valid range`, undefined, {
			value,
			minimum,
			maximum,
			inclusive,
		})
	}
}

/**
 * Decodes Accessibility-domain nodes into a flat serializable tree, throwing a `BrowserError`
 * off-shape.
 *
 * @param value - Unknown full or partial AX-tree result
 * @returns Valid accessibility snapshot
 */
export function readBrowserAccessibility(value: unknown): BrowserAccessibilitySnapshot {
	if (!isRecord(value) || !isArray(value['nodes'])) {
		throw new BrowserError('Browser accessibility tree is malformed')
	}
	const nodes: BrowserAXNode[] = []
	for (const [index, candidate] of value['nodes'].entries()) {
		if (!isRecord(candidate) || !isString(candidate['nodeId'])) {
			throw new BrowserError('Browser accessibility node is malformed', undefined, { index })
		}
		const children = isArray(candidate['childIds']) ? candidate['childIds'].filter(isString) : []
		const properties: Record<string, unknown> = {}
		if (isArray(candidate['properties'])) {
			for (const property of candidate['properties']) {
				if (!isRecord(property) || !isString(property['name'])) continue
				properties[property['name']] = readBrowserAXValue(property['value'])
			}
		}
		nodes.push({
			id: candidate['nodeId'],
			parent: isString(candidate['parentId']) ? candidate['parentId'] : undefined,
			children,
			backend: isInteger(candidate['backendDOMNodeId']) ? candidate['backendDOMNodeId'] : undefined,
			frame: isString(candidate['frameId']) ? candidate['frameId'] : undefined,
			ignored: candidate['ignored'] === true,
			role: parseBrowserAXString(candidate['role']),
			name: parseBrowserAXString(candidate['name']),
			description: parseBrowserAXString(candidate['description']),
			value: readBrowserAXValue(candidate['value']),
			properties,
		})
	}
	return {
		roots: nodes.filter((node) => node.parent === undefined).map((node) => node.id),
		nodes,
	}
}

/**
 * Decodes an Accessibility-domain AXValue, or `undefined` when the record carries none.
 *
 * @param value - Unknown AX value
 * @returns Underlying value
 */
export function readBrowserAXValue(value: unknown): unknown {
	return isRecord(value) && 'value' in value ? value['value'] : undefined
}

/**
 * Concatenates byte chunks without Node-specific buffers.
 *
 * @param chunks - Byte arrays in source order
 * @returns Combined bytes
 */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const count = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
	const result = new Uint8Array(count)
	let offset = 0
	for (const chunk of chunks) {
		result.set(chunk, offset)
		offset += chunk.byteLength
	}
	return result
}

/**
 * Decodes one `IO.read` response, throwing a `BrowserError` off-shape.
 *
 * @param value - Unknown protocol result
 * @returns Valid stream chunk
 */
export function readBrowserStreamChunk(value: unknown): BrowserStreamChunk {
	if (!isRecord(value) || !isString(value['data'])) {
		throw new BrowserError('Browser IO stream chunk is malformed')
	}
	return {
		bytes:
			value['base64Encoded'] === true ? decodeBase64(value['data']) : textToBytes(value['data']),
		eof: value['eof'] === true,
	}
}

/**
 * Decodes JavaScript precise coverage, throwing a `BrowserError` off-shape.
 *
 * @param value - Unknown `Profiler.takePreciseCoverage` result
 * @returns Script coverage
 */
export function readBrowserScriptCoverage(value: unknown): readonly BrowserScriptCoverage[] {
	if (!isRecord(value) || !isArray(value['result'])) {
		throw new BrowserError('Browser JavaScript coverage is malformed')
	}
	return value['result'].map((script, index) => {
		if (
			!isRecord(script) ||
			!isString(script['scriptId']) ||
			!isString(script['url']) ||
			!isArray(script['functions'])
		) {
			throw new BrowserError('Browser script coverage entry is malformed', undefined, { index })
		}
		const functions: BrowserFunctionCoverage[] = script['functions'].map((entry, functionIndex) => {
			if (!isRecord(entry) || !isString(entry['functionName']) || !isArray(entry['ranges'])) {
				throw new BrowserError('Browser function coverage entry is malformed', undefined, {
					index,
					function: functionIndex,
				})
			}
			return {
				name: entry['functionName'],
				ranges: readBrowserCoverageRanges(entry['ranges'], index),
				block: entry['isBlockCoverage'] === true,
			}
		})
		return {
			id: script['scriptId'],
			url: script['url'],
			functions,
		}
	})
}

/**
 * Decodes CSS rule usage, throwing a `BrowserError` off-shape.
 *
 * @param value - Unknown `CSS.stopRuleUsageTracking` result
 * @returns Stylesheet coverage
 */
export function readBrowserStyleCoverage(value: unknown): readonly BrowserStyleCoverage[] {
	if (!isRecord(value) || !isArray(value['ruleUsage'])) {
		throw new BrowserError('Browser CSS coverage is malformed')
	}
	const styles = new Map<string, BrowserCoverageRange[]>()
	for (const [index, entry] of value['ruleUsage'].entries()) {
		if (
			!isRecord(entry) ||
			!isString(entry['styleSheetId']) ||
			!isInteger(entry['startOffset']) ||
			entry['startOffset'] < 0 ||
			!isInteger(entry['endOffset']) ||
			entry['endOffset'] < entry['startOffset']
		) {
			throw new BrowserError('Browser CSS coverage entry is malformed', undefined, { index })
		}
		const ranges = styles.get(entry['styleSheetId']) ?? []
		ranges.push({
			start: entry['startOffset'],
			end: entry['endOffset'],
			count: entry['used'] === true ? 1 : 0,
		})
		styles.set(entry['styleSheetId'], ranges)
	}
	return [...styles].map(([id, ranges]) => ({ id, ranges }))
}

/**
 * Decodes and normalizes coverage ranges, throwing a `BrowserError` off-shape.
 *
 * @param value - Unknown ranges
 * @param script - Script index for diagnostics
 * @returns Valid ranges
 */
export function readBrowserCoverageRanges(
	value: unknown,
	script: number,
): readonly BrowserCoverageRange[] {
	if (!isArray(value)) {
		throw new BrowserError('Browser coverage ranges are malformed', undefined, { script })
	}
	return value.map((range, index) => {
		if (
			!isRecord(range) ||
			!isInteger(range['startOffset']) ||
			range['startOffset'] < 0 ||
			!isInteger(range['endOffset']) ||
			range['endOffset'] < range['startOffset'] ||
			!isInteger(range['count']) ||
			range['count'] < 0
		) {
			throw new BrowserError('Browser coverage range is malformed', undefined, {
				script,
				index,
			})
		}
		return {
			start: range['startOffset'],
			end: range['endOffset'],
			count: range['count'],
		}
	})
}

/**
 * Decodes Performance-domain metrics, throwing a `BrowserError` off-shape.
 *
 * @param value - Unknown metrics result
 * @returns Valid metrics
 */
export function readBrowserMetrics(value: unknown): readonly BrowserMetric[] {
	if (!isRecord(value) || !isArray(value['metrics'])) {
		throw new BrowserError('Browser performance metrics are malformed')
	}
	return value['metrics'].map((metric, index) => {
		if (!isRecord(metric) || !isString(metric['name']) || !isFiniteNumber(metric['value'])) {
			throw new BrowserError('Browser performance metric is malformed', undefined, { index })
		}
		return { name: metric['name'], value: metric['value'] }
	})
}

/**
 * Decodes one CPU profile, throwing a `BrowserError` off-shape.
 *
 * @param value - Unknown `Profiler.stop` result
 * @returns Valid profile
 */
export function readBrowserProfile(value: unknown): BrowserProfile {
	if (!isRecord(value) || !isRecord(value['profile'])) {
		throw new BrowserError('Browser CPU profile is malformed')
	}
	const profile = value['profile']
	if (
		!isFiniteNumber(profile['startTime']) ||
		!isFiniteNumber(profile['endTime']) ||
		profile['endTime'] < profile['startTime'] ||
		!isArray(profile['nodes'])
	) {
		throw new BrowserError('Browser CPU profile metadata is malformed')
	}
	const nodes: BrowserProfileNode[] = profile['nodes'].map((node, index) => {
		if (
			!isRecord(node) ||
			!isInteger(node['id']) ||
			node['id'] < 0 ||
			(node['hitCount'] !== undefined && (!isInteger(node['hitCount']) || node['hitCount'] < 0))
		) {
			throw new BrowserError('Browser CPU profile node is malformed', undefined, { index })
		}
		const children = node['children'] === undefined ? [] : parseArray(node['children'], isInteger)
		if (children === undefined || children.some((child) => child < 0)) {
			throw new BrowserError('Browser CPU profile node is malformed', undefined, { index })
		}
		return {
			id: node['id'],
			frame: readBrowserProfileFrame(node['callFrame'], index),
			hit: isInteger(node['hitCount']) ? node['hitCount'] : undefined,
			children,
		}
	})
	const samples = profile['samples'] === undefined ? [] : parseArray(profile['samples'], isInteger)
	if (samples === undefined || samples.some((sample) => sample < 0)) {
		throw new BrowserError('Browser CPU profile samples are malformed')
	}
	const deltas =
		profile['timeDeltas'] === undefined ? [] : parseArray(profile['timeDeltas'], isFiniteNumber)
	if (deltas === undefined || deltas.some((delta) => delta < 0)) {
		throw new BrowserError('Browser CPU profile deltas are malformed')
	}
	return {
		start: profile['startTime'],
		end: profile['endTime'],
		nodes,
		samples,
		deltas,
	}
}

/**
 * Decodes a CPU profile call frame, throwing a `BrowserError` off-shape.
 *
 * @param value - Unknown call frame
 * @param node - Node index for diagnostics
 * @returns Valid call frame
 */
export function readBrowserProfileFrame(value: unknown, node: number): BrowserProfileFrame {
	if (
		!isRecord(value) ||
		!isString(value['functionName']) ||
		!isString(value['scriptId']) ||
		!isString(value['url']) ||
		!isInteger(value['lineNumber']) ||
		!isInteger(value['columnNumber'])
	) {
		throw new BrowserError('Browser CPU profile call frame is malformed', undefined, { node })
	}
	return {
		function: value['functionName'],
		script: value['scriptId'],
		url: value['url'],
		line: value['lineNumber'],
		column: value['columnNumber'],
	}
}

/**
 * Converts a typed cookie input into Chromium protocol fields.
 *
 * @param cookie - Validated public cookie input
 * @returns Protocol cookie record
 */
export function cookieToProtocol(cookie: BrowserCookieInput): Readonly<Record<string, unknown>> {
	if (cookie.name.length === 0) throw new BrowserError('Browser cookie name cannot be empty')
	if (cookie.url === undefined && (cookie.domain === undefined || cookie.path === undefined)) {
		throw new BrowserError('Browser cookie requires either url or domain with path', undefined, {
			name: cookie.name,
		})
	}
	if (cookie.url !== undefined && !URL.canParse(cookie.url)) {
		throw new BrowserError('Browser cookie URL must be valid', undefined, {
			name: cookie.name,
			url: cookie.url,
		})
	}
	if (cookie.expires !== undefined && !isFiniteNumber(cookie.expires)) {
		throw new BrowserError('Browser cookie expiry must be finite', undefined, {
			name: cookie.name,
			expires: cookie.expires,
		})
	}
	const result: Record<string, unknown> = {
		name: cookie.name,
		value: cookie.value,
	}
	if (cookie.url !== undefined) result['url'] = cookie.url
	if (cookie.domain !== undefined) result['domain'] = cookie.domain
	if (cookie.path !== undefined) result['path'] = cookie.path
	if (cookie.expires !== undefined) result['expires'] = cookie.expires
	if (cookie.http !== undefined) result['httpOnly'] = cookie.http
	if (cookie.secure !== undefined) result['secure'] = cookie.secure
	if (cookie.site !== undefined) result['sameSite'] = cookie.site
	if (cookie.priority !== undefined) result['priority'] = cookie.priority
	if (cookie.partition !== undefined) {
		result['partitionKey'] = {
			topLevelSite: cookie.partition.site,
			hasCrossSiteAncestor: cookie.partition.ancestor ?? false,
		}
	}
	return result
}

/**
 * Decodes the cookies `Storage.getCookies` returns, throwing a `BrowserError` off-shape.
 *
 * @param value - Unknown protocol result
 * @returns Valid cookies
 */
export function readBrowserCookies(value: unknown): readonly BrowserCookie[] {
	if (!isRecord(value) || !isArray(value['cookies'])) {
		throw new BrowserError('Browser cookie result is malformed')
	}
	return value['cookies'].map((candidate, index) => readBrowserCookie(candidate, index))
}

/**
 * Decodes one Chromium cookie, throwing a `BrowserError` off-shape.
 *
 * @param value - Unknown cookie record
 * @param index - Source array position for diagnostics
 * @returns Valid cookie
 */
export function readBrowserCookie(value: unknown, index: number): BrowserCookie {
	if (
		!isRecord(value) ||
		!isString(value['name']) ||
		!isString(value['value']) ||
		!isString(value['domain']) ||
		!isString(value['path']) ||
		!isFiniteNumber(value['expires']) ||
		!isBoolean(value['httpOnly']) ||
		!isBoolean(value['secure'])
	) {
		throw new BrowserError('Browser cookie is malformed', undefined, { index })
	}
	const sameSite = parseEnum(value['sameSite'], ['Strict', 'Lax', 'None'])
	if (value['sameSite'] !== undefined && sameSite === undefined) {
		throw new BrowserError('Browser cookie same-site policy is malformed', undefined, { index })
	}
	return {
		name: value['name'],
		value: value['value'],
		domain: value['domain'],
		path: value['path'],
		expires: value['expires'],
		http: value['httpOnly'],
		secure: value['secure'],
		site: sameSite,
		partition: parseBrowserCookiePartition(value['partitionKey']),
	}
}

/**
 * Matches a decoded cookie against one request URL.
 *
 * @param cookie - Decoded context cookie
 * @param value - Candidate absolute URL
 * @returns True if domain, path, and secure constraints match; false otherwise
 */
export function matchesBrowserCookieURL(cookie: BrowserCookie, value: string): boolean {
	const result = attempt(() => new URL(value))
	if (!result.success) {
		throw new BrowserError('Browser cookie URL must be valid', undefined, { url: value })
	}
	const url = result.value
	const domain = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain
	const domainMatches = url.hostname === domain || url.hostname.endsWith(`.${domain}`)
	const pathMatches =
		url.pathname === cookie.path ||
		(url.pathname.startsWith(cookie.path) &&
			(cookie.path.endsWith('/') || url.pathname[cookie.path.length] === '/'))
	const secureMatches = !cookie.secure || url.protocol === 'https:' || url.protocol === 'wss:'
	return domainMatches && pathMatches && secureMatches
}

/**
 * Decodes one in-page web-storage snapshot, throwing a `BrowserError` off-shape.
 *
 * @param value - Unknown evaluation result
 * @param origin - Origin represented by the result
 * @returns Valid origin storage
 */
export function readBrowserStorageOrigin(value: unknown, origin: string): BrowserStorageOrigin {
	if (!isRecord(value))
		throw new BrowserError('Browser storage result is malformed', undefined, { origin })
	return {
		origin,
		local: readBrowserStorageEntries(value['local'], origin, 'local'),
		session: readBrowserStorageEntries(value['session'], origin, 'session'),
	}
}

/**
 * Decodes a list of web-storage entries, throwing a `BrowserError` off-shape.
 *
 * @param value - Unknown entry list
 * @param origin - Origin used for diagnostics
 * @param storage - Storage family used for diagnostics
 * @returns Valid key/value entries
 */
export function readBrowserStorageEntries(
	value: unknown,
	origin: string,
	storage: 'local' | 'session',
): readonly BrowserStorageEntry[] {
	if (!isArray(value)) {
		throw new BrowserError('Browser storage entries are malformed', undefined, { origin, storage })
	}
	return value.map((entry, index) => {
		if (!isRecord(entry) || !isString(entry['name']) || !isString(entry['value'])) {
			throw new BrowserError('Browser storage entry is malformed', undefined, {
				origin,
				storage,
				index,
			})
		}
		return { name: entry['name'], value: entry['value'] }
	})
}

/**
 * Converts typed media preferences to Chromium emulated media features.
 *
 * @param media - Public media configuration
 * @returns Protocol feature records
 */
export function mediaToFeatures(
	media: BrowserMedia,
): ReadonlyArray<Readonly<Record<string, string>>> {
	const features: Array<Readonly<Record<string, string>>> = []
	if (media.scheme !== undefined) {
		features.push({ name: 'prefers-color-scheme', value: media.scheme })
	}
	if (media.contrast !== undefined) {
		features.push({ name: 'prefers-contrast', value: media.contrast })
	}
	if (media.motion !== undefined) {
		features.push({ name: 'prefers-reduced-motion', value: media.motion })
	}
	if (media.colors !== undefined) {
		features.push({ name: 'forced-colors', value: media.colors })
	}
	return features
}

/**
 * Decodes a Chromium runtime stack trace, skipping every off-shape call frame.
 *
 * @param value - Unknown stack trace or call-frame list
 * @returns Valid stack frames
 */
export function readBrowserStack(value: unknown): readonly BrowserStackFrame[] {
	const frames = isRecord(value) ? value['callFrames'] : value
	if (!isArray(frames)) return []
	const stack: BrowserStackFrame[] = []
	for (const frame of frames) {
		if (
			!isRecord(frame) ||
			!isString(frame['url']) ||
			!isString(frame['functionName']) ||
			!isInteger(frame['lineNumber']) ||
			!isInteger(frame['columnNumber'])
		) {
			continue
		}
		stack.push({
			url: frame['url'],
			function: frame['functionName'],
			line: frame['lineNumber'],
			column: frame['columnNumber'],
		})
	}
	return stack
}

/**
 * Decodes a Runtime remote object's printable value, falling back to its unserializable form
 * and then its description, or `undefined` when it carries none.
 *
 * @param value - Unknown remote object
 * @returns By-value data or a description
 */
export function readBrowserRemoteValue(value: unknown): unknown {
	if (!isRecord(value)) return undefined
	if ('value' in value) return value['value']
	if (isString(value['unserializableValue'])) return value['unserializableValue']
	if (isString(value['description'])) return value['description']
	return undefined
}

/**
 * Decodes one CDP `Runtime.evaluate` result, throwing a `BrowserError` on a failed evaluation
 * and a `BrowserResultLimitError` past the guarded result size.
 *
 * @param value - Unknown CDP result
 * @returns The returned by-value payload, or undefined
 */
export function readEvaluationResult(value: unknown): unknown {
	if (!isRecord(value)) return undefined

	if (isRecord(value['exceptionDetails'])) {
		const details = value['exceptionDetails']
		if (isRecord(details['exception']) && isString(details['exception']['description'])) {
			const description = details['exception']['description']
			const limitMatch = BROWSER_RESULT_LIMIT_PATTERN.exec(description)
			if (limitMatch !== null) {
				throw new BrowserResultLimitError('Evaluation result exceeds BROWSER_RESULT_LIMIT', {
					length: Number(limitMatch[1]),
					limit: BROWSER_RESULT_LIMIT,
				})
			}
			throw new BrowserError(description)
		}
		throw new BrowserError('JavaScript evaluation failed')
	}

	const remoteObject = value['result']
	if (!isRecord(remoteObject)) return undefined
	return 'value' in remoteObject ? remoteObject['value'] : undefined
}

/**
 * Requires an evaluated browser value to be a string.
 *
 * @param value - Candidate evaluated value
 * @param field - Human-readable field name used in the error
 * @returns The narrowed string
 */
export function requireBrowserString(value: unknown, field: string): string {
	if (isString(value)) return value
	throw new BrowserError(`${field} failed: no string value returned`)
}

/**
 * Reads the execution context id from a CDP `Page.createIsolatedWorld` reply.
 *
 * @param value - Unknown CDP result
 * @param frame - The frame id the world was created for, which the error context names
 * @returns The execution context id of the created world
 * @throws Thrown when the reply carries no integer `executionContextId`.
 */
export function readBrowserWorld(value: unknown, frame: string): number {
	if (isRecord(value) && isInteger(value['executionContextId'])) {
		return value['executionContextId']
	}
	throw new BrowserError('Failed to create frame execution context', undefined, { frame })
}

/**
 * Extracts one bounded slice of a projected text, cutting after a line break where one fits.
 *
 * @remarks
 * `offset` and `limit` count UTF-16 code units. A slice whose window reaches the end of the text
 * holds the rest of it. Otherwise the slice ends after the last line break inside
 * `offset` to `offset + limit` that lies past `offset`, and at `offset + limit` when none does. A
 * hard cut that would end on the high half of a surrogate pair ends one unit earlier, so a limit
 * of 1 before a pair yields an empty slice rather than a lone surrogate. An `offset` at or past
 * the end yields an empty slice.
 *
 * @param text - The whole projection
 * @param offset - The index the slice starts at. Default: `0`
 * @param limit - The most characters the slice holds. Default: unbounded
 * @returns The slice, its start, and the length of the whole text
 * @throws Thrown when `offset` is not a non-negative integer or `limit` is not a positive integer.
 *
 * @example
 * ```ts
 * import { extractBrowserSlice } from '@orkestrel/browser'
 *
 * extractBrowserSlice('alpha\nbeta\ngamma', 0, 12) // { text: 'alpha\nbeta\n', offset: 0, total: 16 }
 * ```
 */
export function extractBrowserSlice(text: string, offset = 0, limit?: number): BrowserReadResult {
	if (!isInteger(offset) || offset < 0) {
		throw new BrowserError('Browser read offset must be a non-negative integer', undefined, {
			offset,
		})
	}
	if (limit !== undefined && (!isInteger(limit) || limit < 1)) {
		throw new BrowserError('Browser read limit must be a positive integer', undefined, { limit })
	}
	const total = text.length
	if (limit === undefined || offset + limit >= total) {
		return { text: text.slice(offset), offset, total }
	}
	const window = text.slice(offset, offset + limit)
	const line = window.lastIndexOf('\n')
	if (line > 0) return { text: window.slice(0, line + 1), offset, total }
	const last = window.charCodeAt(limit - 1)
	const next = text.charCodeAt(offset + limit)
	const split = last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
	return { text: split ? window.slice(0, -1) : window, offset, total }
}

/**
 * Decodes a flattened CDP `Page.getFrameTree` result into depth-first frame metadata, skipping
 * every off-shape frame, then appends each attached out-of-process iframe target the tree does
 * not list.
 *
 * @param value - Unknown CDP result
 * @param targets - Attached iframe targets, each described as a frame
 * @returns Frame metadata in depth-first, main-frame-first order, then the unlisted targets
 */
export function readBrowserFrames(
	value: unknown,
	targets: readonly BrowserFrameInfo[] = [],
): readonly BrowserFrameInfo[] {
	const frames: BrowserFrameInfo[] = []
	const stack: Array<Readonly<Record<string, unknown>>> =
		isRecord(value) && isRecord(value['frameTree']) ? [value['frameTree']] : []

	while (stack.length > 0) {
		const node = stack.pop()
		if (node === undefined) break
		const frame = node['frame']

		if (isRecord(frame) && isString(frame['id']) && isString(frame['url'])) {
			frames.push({
				id: frame['id'],
				parent: isString(frame['parentId']) ? frame['parentId'] : undefined,
				name: isString(frame['name']) && frame['name'] !== '' ? frame['name'] : undefined,
				url: frame['url'],
			})
		}

		const children = node['childFrames']
		if (!isArray(children)) continue
		for (let index = children.length - 1; index >= 0; index -= 1) {
			const child = children[index]
			if (isRecord(child)) stack.push(child)
		}
	}

	for (const target of targets) {
		if (!frames.some((frame) => frame.id === target.id)) frames.push(target)
	}
	return frames
}

/**
 * Decodes the first `DOM.getContentQuads` quad and its center, throwing a `BrowserError`
 * off-shape.
 *
 * @param value - Unknown CDP result
 * @returns Decoded quad
 */
export function readBrowserQuad(value: unknown): BrowserQuad {
	if (!isRecord(value) || !isArray(value['quads'])) {
		throw new BrowserError('Element has no content quad')
	}
	const points = parseNumberArray(value['quads'][0])
	if (points === undefined || points.length !== 8) {
		throw new BrowserError('Element has a malformed content quad')
	}
	const x1 = points[0]
	const y1 = points[1]
	const x2 = points[2]
	const y2 = points[3]
	const x3 = points[4]
	const y3 = points[5]
	const x4 = points[6]
	const y4 = points[7]
	if (
		x1 === undefined ||
		y1 === undefined ||
		x2 === undefined ||
		y2 === undefined ||
		x3 === undefined ||
		y3 === undefined ||
		x4 === undefined ||
		y4 === undefined
	) {
		throw new BrowserError('Element has a malformed content quad')
	}
	return {
		points: [x1, y1, x2, y2, x3, y3, x4, y4],
		center: {
			x: (x1 + x2 + x3 + x4) / 4,
			y: (y1 + y2 + y3 + y4) / 4,
		},
	}
}

/**
 * Extracts a keyboard chord such as `Control+Shift+P` into its parts, throwing a
 * `BrowserError` on an empty chord or an unsupported modifier.
 *
 * @param value - Chord source
 * @returns Canonical modifiers and terminal key
 * @throws Thrown when the chord is empty or names an unsupported modifier.
 */
export function extractBrowserChord(value: string): BrowserChord {
	const parts = value.split('+').filter((part) => part.length > 0)
	const key = parts.pop()
	if (key === undefined) throw new BrowserError('Browser key chord is empty')
	const modifiers = parts.map((modifier) => {
		switch (modifier) {
			case 'Ctrl':
				return 'Control'
			case 'Cmd':
			case 'Command':
				return 'Meta'
			default:
				return modifier
		}
	})
	for (const modifier of modifiers) {
		if (BROWSER_KEY_MODIFIERS[modifier] === undefined) {
			throw new BrowserError(`Unsupported browser key modifier: ${modifier}`)
		}
	}
	return { modifiers, key }
}

/**
 * Computes the CDP Input modifier bitmask.
 *
 * @param modifiers - Canonical modifier names
 * @returns Combined CDP modifier mask
 */
export function computeBrowserModifiers(modifiers: readonly string[]): number {
	let mask = 0
	for (const modifier of modifiers) mask |= BROWSER_KEY_MODIFIERS[modifier] ?? 0
	return mask
}

/**
 * Computes the CDP Input pressed-button bitmask.
 *
 * @param buttons - Pressed public mouse buttons
 * @returns Combined CDP pressed-button mask
 */
export function computeBrowserButtons(buttons: readonly BrowserMouseButton[]): number {
	let mask = 0
	for (const button of buttons) mask |= BROWSER_MOUSE_BUTTON_MASKS[button]
	return mask
}

/**
 * Normalizes one key to CDP keyboard event data.
 *
 * @param value - Key value or canonical key name
 * @returns Normalized key data
 */
export function keyToBrowserInput(value: string): BrowserKey {
	const named: Readonly<Record<string, BrowserKey>> = {
		Backspace: { key: 'Backspace', code: 'Backspace', text: undefined, number: 8 },
		Tab: { key: 'Tab', code: 'Tab', text: '\t', number: 9 },
		Enter: { key: 'Enter', code: 'Enter', text: '\r', number: 13 },
		Shift: { key: 'Shift', code: 'ShiftLeft', text: undefined, number: 16 },
		Control: { key: 'Control', code: 'ControlLeft', text: undefined, number: 17 },
		Alt: { key: 'Alt', code: 'AltLeft', text: undefined, number: 18 },
		Escape: { key: 'Escape', code: 'Escape', text: undefined, number: 27 },
		Space: { key: ' ', code: 'Space', text: ' ', number: 32 },
		PageUp: { key: 'PageUp', code: 'PageUp', text: undefined, number: 33 },
		PageDown: { key: 'PageDown', code: 'PageDown', text: undefined, number: 34 },
		End: { key: 'End', code: 'End', text: undefined, number: 35 },
		Home: { key: 'Home', code: 'Home', text: undefined, number: 36 },
		ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', text: undefined, number: 37 },
		ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', text: undefined, number: 38 },
		ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', text: undefined, number: 39 },
		ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', text: undefined, number: 40 },
		Delete: { key: 'Delete', code: 'Delete', text: undefined, number: 46 },
		Meta: { key: 'Meta', code: 'MetaLeft', text: undefined, number: 91 },
	}
	const matched = named[value]
	if (matched !== undefined) return matched
	if ([...value].length !== 1) throw new BrowserError(`Unsupported browser key: ${value}`)
	const character = [...value][0]
	if (character === undefined) throw new BrowserError('Browser key is empty')
	const upper = character.toUpperCase()
	const letter = /^[A-Z]$/.test(upper)
	const digit = /^[0-9]$/.test(character)
	return {
		key: character,
		code: letter ? `Key${upper}` : digit ? `Digit${character}` : '',
		text: character,
		number: upper.charCodeAt(0),
	}
}

/**
 * Decodes CDP snapshot sparse string data into a node-index map, skipping every off-shape
 * entry.
 *
 * @param value - Sparse `{ index, value }` record
 * @param strings - Snapshot string table
 * @returns Node-index to string map
 */
export function readRareStringData(
	value: unknown,
	strings: readonly string[],
): ReadonlyMap<number, string> {
	const decoded = new Map<number, string>()
	if (!isRecord(value)) return decoded
	const indexes = parseNumberArray(value['index'])
	const values = parseNumberArray(value['value'])
	if (indexes === undefined || values === undefined) return decoded

	for (let index = 0; index < indexes.length; index += 1) {
		const node = indexes[index]
		const text = parseSnapshotString(strings, values[index])
		if (node !== undefined && text !== undefined) decoded.set(node, text)
	}
	return decoded
}

/**
 * Decodes CDP snapshot sparse boolean data into a set of node indexes, skipping every
 * off-shape entry.
 *
 * @param value - Sparse `{ index }` record
 * @returns Set of node indexes whose value is true
 */
export function readRareBooleanData(value: unknown): ReadonlySet<number> {
	if (!isRecord(value)) return new Set()
	return new Set(parseNumberArray(value['index']) ?? [])
}

/**
 * Decodes CDP snapshot sparse integer data into a node-index map, skipping every off-shape
 * entry.
 *
 * @param value - Sparse `{ index, value }` record
 * @returns Node-index to integer map
 */
export function readRareIntegerData(value: unknown): ReadonlyMap<number, number> {
	const decoded = new Map<number, number>()
	if (!isRecord(value)) return decoded
	const indexes = parseNumberArray(value['index'])
	const values = parseNumberArray(value['value'])
	if (indexes === undefined || values === undefined) return decoded

	for (let index = 0; index < indexes.length; index += 1) {
		const node = indexes[index]
		const integer = values[index]
		if (node !== undefined && integer !== undefined) decoded.set(node, integer)
	}
	return decoded
}

/**
 * Decodes flattened CDP node attributes into a frozen record, skipping every off-shape pair.
 *
 * @param value - Candidate string-index array
 * @param strings - Snapshot string table
 * @returns Frozen attribute record
 */
export function readBrowserAttributes(
	value: unknown,
	strings: readonly string[],
): Readonly<Record<string, string>> {
	const indexes = parseNumberArray(value)
	const attributes: Record<string, string> = {}
	if (indexes === undefined) return Object.freeze(attributes)

	for (let index = 0; index < indexes.length; index += 2) {
		const name = parseSnapshotString(strings, indexes[index])
		const attribute = parseSnapshotString(strings, indexes[index + 1])
		if (name !== undefined && attribute !== undefined) attributes[name] = attribute
	}
	return Object.freeze(attributes)
}

/**
 * Decodes a CDP `DOMSnapshot.captureSnapshot` result into a serializable
 * `BrowserSnapshotInput`, throwing a `BrowserError` off-shape and a `BrowserResultLimitError`
 * past the configured node limit.
 *
 * @param value - Unknown CDP result
 * @param styles - Requested computed-style names, in protocol order
 * @param limit - Maximum accepted node count
 * @returns A typed serializable browser snapshot
 */
export function readBrowserSnapshot(
	value: unknown,
	styles: readonly string[] = [],
	limit = BROWSER_SNAPSHOT_NODE_LIMIT,
): BrowserSnapshotInput {
	if (!isInteger(limit) || limit < 0) {
		throw new BrowserError('Browser snapshot limit must be a non-negative integer', undefined, {
			limit,
		})
	}
	if (!isRecord(value) || !isArray(value['strings']) || !isArray(value['documents'])) {
		throw new BrowserError('Malformed DOMSnapshot.captureSnapshot result')
	}
	const strings = parseArray(value['strings'], isString)
	if (strings === undefined) {
		throw new BrowserError('Malformed DOMSnapshot string table')
	}
	let count = 0
	for (const document of value['documents']) {
		if (!isRecord(document) || !isRecord(document['nodes'])) continue
		count += parseNumberArray(document['nodes']['nodeType'])?.length ?? 0
	}
	if (count > limit) {
		throw new BrowserResultLimitError('DOM snapshot exceeds the configured node limit', {
			length: count,
			limit,
		})
	}

	const documents: BrowserDocument[] = []
	for (let documentIndex = 0; documentIndex < value['documents'].length; documentIndex += 1) {
		const rawDocument = value['documents'][documentIndex]
		if (!isRecord(rawDocument) || !isRecord(rawDocument['nodes'])) {
			throw new BrowserError('Malformed DOM snapshot document', undefined, {
				document: documentIndex,
			})
		}

		const rawNodes = rawDocument['nodes']
		const frame = parseSnapshotString(strings, rawDocument['frameId'])
		const url = parseSnapshotString(strings, rawDocument['documentURL'])
		const title =
			rawDocument['title'] === -1 ? '' : parseSnapshotString(strings, rawDocument['title'])
		if (frame === undefined || url === undefined || title === undefined) {
			throw new BrowserError('Malformed DOM snapshot document metadata', undefined, {
				document: documentIndex,
			})
		}
		const types = parseNumberArray(rawNodes['nodeType'])
		const names = parseNumberArray(rawNodes['nodeName'])
		const values = parseNumberArray(rawNodes['nodeValue'])
		if (types === undefined || names === undefined || values === undefined) {
			throw new BrowserError('Malformed DOM snapshot node table', undefined, {
				document: documentIndex,
			})
		}

		const parents = parseNumberArray(rawNodes['parentIndex']) ?? []
		const ids = parseNumberArray(rawNodes['backendNodeId']) ?? []
		const rawAttributes = isArray(rawNodes['attributes']) ? rawNodes['attributes'] : []
		const texts = readRareStringData(rawNodes['textValue'], strings)
		const inputs = readRareStringData(rawNodes['inputValue'], strings)
		const checked = readRareBooleanData(rawNodes['inputChecked'])
		const selected = readRareBooleanData(rawNodes['optionSelected'])
		const clickable = readRareBooleanData(rawNodes['isClickable'])
		const shadows = readRareStringData(rawNodes['shadowRootType'], strings)
		const contents = readRareIntegerData(rawNodes['contentDocumentIndex'])
		const pseudos = readRareStringData(rawNodes['pseudoType'], strings)
		const sources = readRareStringData(rawNodes['currentSourceURL'], strings)
		const origins = readRareStringData(rawNodes['originURL'], strings)
		const layouts = new Map<number, BrowserLayout>()

		if (isRecord(rawDocument['layout'])) {
			const rawLayout = rawDocument['layout']
			const nodeIndexes = parseNumberArray(rawLayout['nodeIndex']) ?? []
			const rawStyles = isArray(rawLayout['styles']) ? rawLayout['styles'] : []
			const rawBounds = isArray(rawLayout['bounds']) ? rawLayout['bounds'] : []
			const rawTexts = parseNumberArray(rawLayout['text']) ?? []
			const paints = parseNumberArray(rawLayout['paintOrders']) ?? []
			const rawOffsets = isArray(rawLayout['offsetRects']) ? rawLayout['offsetRects'] : []
			const rawScrolls = isArray(rawLayout['scrollRects']) ? rawLayout['scrollRects'] : []
			const rawClients = isArray(rawLayout['clientRects']) ? rawLayout['clientRects'] : []

			for (let layoutIndex = 0; layoutIndex < nodeIndexes.length; layoutIndex += 1) {
				const nodeIndex = nodeIndexes[layoutIndex]
				if (nodeIndex === undefined) continue
				const styleIndexes = parseNumberArray(rawStyles[layoutIndex]) ?? []
				const computed: Record<string, string> = {}
				for (let styleIndex = 0; styleIndex < styles.length; styleIndex += 1) {
					const name = styles[styleIndex]
					const style = parseSnapshotString(strings, styleIndexes[styleIndex])
					if (name !== undefined && style !== undefined) computed[name] = style
				}
				layouts.set(nodeIndex, {
					bounds: parseBrowserRect(rawBounds[layoutIndex]),
					styles: Object.freeze(computed),
					text: parseSnapshotString(strings, rawTexts[layoutIndex]),
					paint: paints[layoutIndex],
					offset: parseBrowserRect(rawOffsets[layoutIndex]),
					scroll: parseBrowserRect(rawScrolls[layoutIndex]),
					client: parseBrowserRect(rawClients[layoutIndex]),
				})
			}
		}

		const nodes: BrowserNode[] = []
		for (let nodeIndex = 0; nodeIndex < types.length; nodeIndex += 1) {
			const category = types[nodeIndex]
			const name = parseSnapshotString(strings, names[nodeIndex])
			const nodeValue =
				values[nodeIndex] === -1 ? '' : parseSnapshotString(strings, values[nodeIndex])
			if (category === undefined || name === undefined || nodeValue === undefined) {
				throw new BrowserError('Malformed DOM snapshot node', undefined, {
					document: documentIndex,
					index: nodeIndex,
				})
			}
			const parent = parents[nodeIndex]
			nodes.push({
				document: documentIndex,
				frame,
				index: nodeIndex,
				id: ids[nodeIndex],
				parent: parent === undefined || parent < 0 ? undefined : parent,
				category,
				name,
				value: nodeValue,
				attributes: readBrowserAttributes(rawAttributes[nodeIndex], strings),
				text: texts.get(nodeIndex),
				input: inputs.get(nodeIndex),
				checked: checked.has(nodeIndex) ? true : undefined,
				selected: selected.has(nodeIndex) ? true : undefined,
				clickable: clickable.has(nodeIndex) ? true : undefined,
				shadow: shadows.get(nodeIndex),
				content: contents.get(nodeIndex),
				pseudo: pseudos.get(nodeIndex),
				source: sources.get(nodeIndex),
				origin: origins.get(nodeIndex),
				layout: layouts.get(nodeIndex),
			})
		}

		documents.push({
			index: documentIndex,
			frame,
			url,
			title,
			nodes,
			scroll: [
				isFiniteNumber(rawDocument['scrollOffsetX']) ? rawDocument['scrollOffsetX'] : undefined,
				isFiniteNumber(rawDocument['scrollOffsetY']) ? rawDocument['scrollOffsetY'] : undefined,
			],
			width: isFiniteNumber(rawDocument['contentWidth']) ? rawDocument['contentWidth'] : undefined,
			height: isFiniteNumber(rawDocument['contentHeight'])
				? rawDocument['contentHeight']
				: undefined,
		})
	}

	return { documents, styles: [...styles] }
}

/**
 * Tests whether a browser-node matcher is a declarative query rather than a predicate.
 *
 * @param value - Browser-node query or predicate
 * @returns True if the matcher is a declarative query; false otherwise
 *
 * @example
 * ```ts
 * import { isBrowserNodeQuery } from '@orkestrel/browser'
 *
 * isBrowserNodeQuery({ name: 'main' }) // true
 * isBrowserNodeQuery(() => true) // false
 * ```
 */
export function isBrowserNodeQuery(
	value: BrowserNodeQuery | BrowserNodePredicate,
): value is BrowserNodeQuery {
	return !isFunction(value)
}

/**
 * Tests a captured node against a declarative query.
 *
 * @param node - Captured browser node
 * @param query - Fields every candidate must satisfy
 * @returns True if the node matches; false otherwise
 */
export function matchesBrowserNode(node: BrowserNode, query: BrowserNodeQuery): boolean {
	if (query.name !== undefined && node.name.toLowerCase() !== query.name.toLowerCase()) return false
	if (
		query.text !== undefined &&
		!node.value.includes(query.text) &&
		node.text?.includes(query.text) !== true
	) {
		return false
	}
	if (query.frame !== undefined && node.frame !== query.frame) return false
	if (query.clickable !== undefined && (node.clickable === true) !== query.clickable) return false
	if (query.visible !== undefined && isBrowserNodeVisible(node) !== query.visible) return false
	if (query.attributes !== undefined) {
		for (const [name, value] of Object.entries(query.attributes)) {
			if (node.attributes[name] !== value) return false
		}
	}
	return true
}

/**
 * Tests whether a captured node has a non-empty rendered layout box.
 *
 * @param node - Captured browser node
 * @returns True if the snapshot reports a visible layout box; false otherwise
 */
export function isBrowserNodeVisible(node: BrowserNode): boolean {
	const bounds = node.layout?.bounds
	return bounds !== undefined && bounds[2] > 0 && bounds[3] > 0
}

/**
 * Awaits every teardown step in order and returns the first failure.
 *
 * @remarks
 * A teardown runs every step even after one of them fails, so a later release
 * is never skipped by an earlier fault, and the failure the caller reports is
 * the first one. The failure is returned rather than thrown, so the caller
 * keeps the cleanup that must still run after the steps and decides where the
 * throw belongs. A step may throw any value, `undefined` and `null` included,
 * so the first throw is retained by a separate flag rather than by testing the
 * retained value.
 *
 * @param steps - The teardown steps, in the order they must run
 * @returns The value the first failing step threw, or undefined when no step threw
 *
 * @example
 * ```ts
 * import { settleBrowserTeardown } from '@orkestrel/browser'
 *
 * const failure = await settleBrowserTeardown(
 * 	() => client.close(),
 * 	() => transport.close(),
 * )
 * if (failure !== undefined) throw failure
 * ```
 */
export async function settleBrowserTeardown(
	...steps: readonly BrowserTeardownFunction[]
): Promise<unknown> {
	let failure: unknown
	let settled = false
	for (const step of steps) {
		try {
			await step()
		} catch (error) {
			if (!settled) {
				failure = error
				settled = true
			}
		}
	}
	return failure
}

/**
 * Resolves one exact semantic target and refuses missing or ambiguous matches.
 *
 * @param view - The live element manager
 * @param target - The role and exact accessible name; stored references and selectors are evidence only
 * @param options - The call signal and timeout, with the step id for a refusal sentence
 * @returns The unique matching element
 * @throws Thrown when no element or several elements carry the target
 */
export async function locateBrowserTarget<E extends BrowserElementInterface>(
	view: { readonly elements: BrowserElementManagerInterface<E> },
	target: { readonly role: string; readonly name: string },
	options?: BrowserCallOptions & { readonly id?: string },
): Promise<E> {
	const matches = await view.elements.find(
		{ role: target.role, name: target.name, exact: true },
		options,
	)
	const element = matches[0]
	if (matches.length === 1 && element !== undefined) return element
	const id = options?.id ?? 's1'
	throw new BrowserError(
		`Step ${id} names ${target.role} ${JSON.stringify(target.name)}, which ${matches.length === 0 ? 'no element carries' : `${matches.length} elements carry`}; call edit to remove or replace ${id}.`,
		matches.length === 0 ? 'BROWSER_JOURNEY_TARGET' : 'BROWSER_JOURNEY_AMBIGUOUS',
	)
}

/**
 * Performs a resolved journey step through the toolset's action boundary.
 *
 * @remarks
 * `options.secret` marks a substituted secret text. `options.caller` carries a hold token.
 * An interrupted action returns with its outcome; the following dialog call answers the pending input.
 *
 * @param toolset - The toolset and its structurally typed live view
 * @param id - The step identity used in a refusal
 * @param step - The action, literal arguments, and optional semantic element or tab target
 * @param options - The call signal, caller identity, and secret flag
 * @returns The completed structured action
 * @throws Thrown when resolution fails, the action is refused or times out, or its navigation is still pending
 */
export async function performBrowserStep<E extends BrowserElementInterface>(
	toolset: Pick<BrowserToolsetInterface, 'perform'> & {
		readonly view: { readonly elements: BrowserElementManagerInterface<E> }
	},
	id: string,
	step: {
		readonly action: string
		readonly arguments: Readonly<Record<string, JSONValue>>
		readonly target?: { readonly role: string; readonly name: string }
		readonly tab?: BrowserJourneyTab
	},
	options?: BrowserCallOptions & Pick<ToolContext, 'caller'> & { readonly secret?: boolean },
): Promise<BrowserAction> {
	const context: ToolContext = {
		signal: options?.signal ?? new AbortController().signal,
		...(options?.caller === undefined ? {} : { caller: options.caller }),
	}
	let args = step.arguments
	if ((step.action === 'click' || step.action === 'type') && step.target !== undefined) {
		const element = await locateBrowserTarget(toolset.view, step.target, { ...options, id })
		args = { ...args, ref: element.reference }
	}
	if (step.action === 'type' && options?.secret === true) args = { ...args, secret: true }
	if (step.action === 'switch' && step.tab !== undefined) {
		const listed = await toolset.perform(
			{ id, name: 'tabs', arguments: { what: 'journey target' } },
			context,
		)
		if (!listed.result.success) throw new Error(`${id}: ${listed.result.error}`)
		const matches = String(listed.result.value)
			.split('\n')
			.filter((line) => {
				const match = /^t[1-9]\d* ("(?:[^"\\]|\\.)*") (\S+?)(?: \(current\))?$/.exec(line)
				return match?.[1] === JSON.stringify(step.tab?.title) && match[2] === step.tab?.url
			})
		if (matches.length !== 1)
			throw new BrowserError(
				`${id}: The tab ${JSON.stringify(step.tab.title)} at ${step.tab.url} ${matches.length === 0 ? 'is not open' : 'is ambiguous'}; call tabs.`,
				matches.length === 0 ? 'BROWSER_JOURNEY_TARGET' : 'BROWSER_JOURNEY_AMBIGUOUS',
			)
		args = { ...args, tab: matches[0]?.split(' ')[0] ?? '' }
	}
	const performed = await toolset.perform({ id, name: step.action, arguments: args }, context)
	const action = performed.action
	if (
		action === undefined ||
		(action.outcome !== 'done' && action.outcome !== 'interrupted') ||
		action.stage === 'requested' ||
		action.stage === 'committed'
	)
		throw new Error(
			`${id}: ${action?.receipt ?? (performed.result.success ? String(performed.result.value) : performed.result.error)}`,
		)
	return action
}

/**
 * Collects parameter uses from native arguments and target names, keeping page arguments literal.
 * @param steps - Validated steps
 * @returns Parameter names mapped to their action and field paths
 */
export function collectBrowserJourneyBindings(
	steps: readonly BrowserJourneyStepInput[],
): ReadonlyMap<string, readonly string[]> {
	const bindings = new Map<string, string[]>()
	for (const step of steps) {
		if (!BROWSER_JOURNEY_ACTIONS.some((action) => action === step.action)) continue
		const fields = Object.entries(step.arguments)
		if (step.target !== undefined) fields.push(['target.name', step.target.name])
		for (const [field, value] of fields) {
			if (!isString(value) && isBrowserJourneyBinding(value)) {
				bindings.set(value.parameter, [
					...(bindings.get(value.parameter) ?? []),
					`${step.action}.${field}`,
				])
			}
		}
	}
	return bindings
}

/**
 * Applies an ordered edit batch to a copy and validates its final bindings.
 * @param journey - Valid journey to edit
 * @param edits - Edits in application order
 * @returns The edited journey, with unbound parameters removed
 * @throws BrowserError - Thrown with BROWSER_JOURNEY_EDIT, a one-based index, and a reason clause when the batch fails
 */
export function editBrowserJourney(
	journey: BrowserJourney,
	edits: readonly BrowserJourneyEdit[],
): BrowserJourney {
	validateBrowserJourney(journey)
	const steps = [...journey.steps]
	let parameters = { ...journey.parameters }
	let next = journey.next
	let index = 0
	const declarations = new Map<string, number>()
	try {
		for (const edit of edits) {
			index += 1
			validateBrowserJourneyEdit(edit)
			switch (edit.operation) {
				case 'add': {
					const anchor = edit.before ?? edit.after
					const position =
						anchor === undefined ? steps.length : steps.findIndex((step) => step.id === anchor)
					if (position < 0) throw new BrowserError(`names unknown anchor "${anchor}"`)
					const step = { ...edit.step, id: `s${next}` }
					next += 1
					steps.splice(position + (edit.after === undefined ? 0 : 1), 0, step)
					break
				}
				case 'remove':
				case 'update': {
					const position = steps.findIndex((step) => step.id === edit.id)
					const step = steps[position]
					if (step === undefined) throw new BrowserError(`names unknown step "${edit.id}"`)
					if (edit.operation === 'remove') steps.splice(position, 1)
					else {
						const updated = {
							...step,
							arguments: { ...step.arguments, ...edit.arguments },
							...(edit.target === undefined ? {} : { target: edit.target }),
							...(edit.tab === undefined ? {} : { tab: edit.tab }),
						}
						validateBrowserJourneyStep(updated)
						steps[position] = updated
					}
					break
				}
				case 'declare':
					parameters = { ...parameters, [edit.name]: edit.parameter }
					declarations.set(edit.name, index)
			}
		}
		const bindings = collectBrowserJourneyBindings(steps)
		for (const [name, declaration] of declarations) {
			if (!bindings.has(name)) {
				index = declaration
				throw new BrowserError(`declares "${name}" but no step binds it`)
			}
		}
		parameters = Object.fromEntries(
			Object.entries(parameters).filter(([name]) => bindings.has(name)),
		)
		const candidate = { ...journey, steps, parameters, next }
		validateBrowserJourney(candidate)
		return structuredClone(candidate)
	} catch (error) {
		const reason = (error instanceof Error ? error.message : 'has an invalid edit')
			.replace(/^Invariant \d+ \([^)]*\): /, '')
			.replace(/\.+$/, '')
		throw new BrowserError(`Edit ${index} is refused: it ${reason}`, 'BROWSER_JOURNEY_EDIT', {
			index,
			reason,
		})
	}
}

/**
 * Resolves a native string binding from supplied inputs.
 * @param value - Literal or parameter binding
 * @param inputs - Parameter values
 * @returns Literal text or the bound value
 * @throws BrowserError - Thrown when a binding has no input or the argument is malformed
 */
export function resolveBrowserJourneyBinding(
	value: unknown,
	inputs: Readonly<Record<string, string>>,
): string {
	if (isString(value)) return value
	if (
		isBrowserJourneyBinding(value) &&
		!isString(value) &&
		Object.hasOwn(inputs, value.parameter)
	) {
		const input = inputs[value.parameter]
		if (input !== undefined) return input
	}
	throw new BrowserError('A journey binding has no value', 'BROWSER_JOURNEY_INPUT')
}

/**
 * Renders a journey with its parameter declarations and stable step ids.
 * @param journey - Valid journey
 * @returns The listing text without a trailing newline
 */
export function renderBrowserJourney(journey: BrowserJourney): string {
	validateBrowserJourney(journey)
	const parameters = Object.entries(journey.parameters)
	const defaults = Object.fromEntries(
		parameters.map(([name, parameter]) => [name, parameter.default ?? name]),
	)
	const heading = `${journey.name} ${JSON.stringify(journey.description)}${parameters.length === 0 ? '' : ` (parameters: ${parameters.map(([name, parameter]) => `${name}${parameter.secret === true ? ' (secret)' : ''}`).join(', ')})`}`
	const lines = journey.steps.map((step) => {
		const name =
			step.target === undefined
				? ''
				: `${step.target.role} ${JSON.stringify(resolveBrowserJourneyBinding(step.target.name, defaults))}${isString(step.target.name) ? '' : ` as ${step.target.name.parameter}`}`
		const field = step.action === 'navigate' ? 'url' : step.action === 'press' ? 'key' : 'text'
		const binding = step.arguments[field]
		const text = isBrowserJourneyBinding(binding)
			? resolveBrowserJourneyBinding(binding, defaults)
			: ''
		const suffix =
			!isString(binding) && isBrowserJourneyBinding(binding) ? ` as ${binding.parameter}` : ''
		switch (step.action) {
			case 'navigate':
				return `${step.id} navigate ${text}${suffix}`
			case 'click':
				return `${step.id} click ${name}`
			case 'type': {
				const secret =
					!isString(binding) &&
					isBrowserJourneyBinding(binding) &&
					journey.parameters[binding.parameter]?.secret === true
				return `${step.id} type ${secret ? '(secret)' : JSON.stringify(text)}${suffix} into ${name}${step.arguments['submit'] === true ? ', submit' : ''}`
			}
			case 'press':
				return `${step.id} press ${text}${suffix}`
			case 'wait':
				return `${step.id} wait ${JSON.stringify(text)}${suffix}`
			case 'dialog':
				return `${step.id} dialog ${step.arguments['accept'] === true ? 'accept' : 'dismiss'}${binding === undefined ? '' : ` ${JSON.stringify(text)}${suffix}`}`
			case 'switch':
				return `${step.id} switch ${JSON.stringify(step.tab?.title)} ${step.tab?.url}`
			case 'unresolved':
				return `${step.id} unresolved: ${step.gap}`
			default:
				return `${step.id} ${step.action} ${JSON.stringify(step.arguments)}`
		}
	})
	return [heading, ...lines].join('\n')
}

/**
 * Derives the trigger text a run records for an action.
 * @param step - Valid step
 * @param inputs - Resolved parameter values; default: an empty record
 * @returns The action's trigger in the journey vocabulary
 */
export function deriveBrowserJourneyTrigger(
	step: BrowserJourneyStepInput,
	inputs: Readonly<Record<string, string>> = {},
): string {
	switch (step.action) {
		case 'click':
		case 'type':
			return resolveBrowserJourneyBinding(step.target?.name, inputs)
		case 'press':
			return resolveBrowserJourneyBinding(step.arguments['key'], inputs)
		case 'navigate':
			return resolveBrowserJourneyBinding(step.arguments['url'], inputs)
		case 'wait':
			return resolveBrowserJourneyBinding(step.arguments['text'], inputs)
		case 'switch':
			return step.tab?.title ?? ''
		case 'dialog':
			return step.arguments['accept'] === true ? 'accept' : 'dismiss'
		default:
			return step.action
	}
}

/**
 * Derives an unused lower camel case secret parameter name from an accessible name.
 * @param name - Accessible name of the control
 * @param taken - Already declared names; default: an empty collection
 * @returns The derived name, or the first unused secretN fallback
 */
export function deriveBrowserJourneySecret(name: string, taken: readonly string[] = []): string {
	const words = name
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => word.length > 0)
	const candidate = words
		.map((word, index) =>
			index === 0
				? word.toLowerCase()
				: `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`,
		)
		.join('')
	if (BROWSER_JOURNEY_PARAMETER_PATTERN.test(candidate) && !taken.includes(candidate))
		return candidate
	let count = 1
	while (taken.includes(`secret${count}`)) count += 1
	return `secret${count}`
}

/**
 * Generates a run id from an ISO timestamp and a cryptographic hexadecimal suffix.
 * @returns An ISO timestamp with hyphens replacing colons, followed by four hexadecimal digits
 */
export function generateBrowserRunId(): string {
	const suffix = Array.from(crypto.getRandomValues(new Uint8Array(2)), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('')
	return `${new Date().toISOString().replace(/:/g, '-')}-${suffix}`
}

/**
 * Renders a step receipt without its tool directive or appended view.
 * @param result - Step receipt or refusal
 * @returns A receipt line with directives outside quoted text removed
 */
export function renderBrowserRunResult(result: string): string {
	const receipt = result.split('\n\n')[0] ?? ''
	return receipt
		.split('\n')
		.map((line) => {
			let quoted = false
			let escaped = false
			for (let index = 0; index < line.length; index += 1) {
				const character = line[index]
				if (escaped) {
					escaped = false
					continue
				}
				if (character === '\\' && quoted) {
					escaped = true
					continue
				}
				if (character === '"') quoted = !quoted
				if (!quoted && line.startsWith('; call ', index))
					return `${line.slice(0, index).replace(/\.+$/, '')}.`
			}
			return line
		})
		.join(' ')
}

/**
 * Renders a run heading and its receipts, followed by the supplied final view.
 * @param run - Run to render
 * @param view - Final view from the caller; omitted when unavailable
 * @returns The replay result without a trailing newline
 */
export function renderBrowserRun(run: BrowserRun, view?: string): string {
	const last = run.steps.at(-1)
	const next = run.journey.steps[run.steps.length]
	const at =
		run.outcome === 'aborted' && last?.outcome === 'done'
			? (next?.id ?? last.id)
			: (last?.id ?? next?.id ?? 's1')
	const reason = renderBrowserRunResult(last?.result ?? 'no step completed').replace(/\.+$/, '')
	const heading =
		run.outcome === 'complete'
			? `Replayed ${run.journey.name}: ${run.steps.length} of ${run.journey.steps.length} steps.`
			: run.outcome === 'stopped'
				? `Replay of ${run.journey.name} stopped at ${at} of ${run.journey.steps.length}: ${reason}.`
				: `Replay of ${run.journey.name} aborted at ${at} of ${run.journey.steps.length}.`
	const lines = [
		heading,
		...run.steps.map((step) => `${step.id} ${renderBrowserRunResult(step.result)}`),
	].join('\n')
	return view === undefined || view === '' ? lines : `${lines}\n\n${view}`
}
