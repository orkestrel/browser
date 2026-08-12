import type {
	BrowserCodegenAction,
	BrowserCodegenScriptOptions,
	BrowserBindingCall,
	BrowserChord,
	BrowserCookie,
	BrowserCookieInput,
	BrowserCookiePartition,
	BrowserConsoleMessage,
	BrowserContextOptions,
	BrowserCoverageRange,
	BrowserDocument,
	BrowserDownloadProgress,
	BrowserDownloadStart,
	BrowserEmulationOptions,
	BrowserFrameInfo,
	BrowserFunctionCoverage,
	BrowserHAR,
	BrowserHAREntry,
	BrowserHARPending,
	BrowserHARValue,
	BrowserLayout,
	BrowserMetric,
	BrowserActionabilityOptions,
	BrowserActionOptions,
	BrowserAccessibilityOptions,
	BrowserAccessibilitySnapshot,
	BrowserAXNode,
	BrowserKey,
	BrowserNode,
	BrowserNodePredicate,
	BrowserNodeQuery,
	BrowserPageError,
	BrowserProfile,
	BrowserProfileFrame,
	BrowserProfileNode,
	BrowserMouseButton,
	BrowserPoint,
	BrowserPDFOptions,
	BrowserMedia,
	BrowserRequest,
	BrowserRequestFailure,
	BrowserResponse,
	BrowserRouteQuery,
	BrowserSecurity,
	BrowserQuad,
	BrowserQuery,
	BrowserRect,
	BrowserSnapshotInput,
	BrowserScriptCoverage,
	BrowserScreenshotOptions,
	BrowserStorageEntry,
	BrowserStorageOrigin,
	BrowserStreamChunk,
	BrowserStackFrame,
	BrowserStyleCoverage,
	BrowserTiming,
	BrowserTimingRange,
	BrowserViewport,
	BrowserWebSocketFrame,
} from './types.js'
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
	parseJSON,
} from '@orkestrel/contract'
import {
	BASE64_CHARS,
	BASE64_LOOKUP,
	BROWSER_RESULT_LIMIT,
	BROWSER_RESULT_LIMIT_PATTERN,
	BROWSER_RESULT_LIMIT_SENTINEL_PREFIX,
	BROWSER_SCREENSHOT_ATTRIBUTE,
	BROWSER_SNAPSHOT_NODE_LIMIT,
	BROWSER_STABLE_FRAME_COUNT,
	BROWSER_TEST_ID_ATTRIBUTE,
	BROWSER_KEY_MODIFIERS,
	BROWSER_MOUSE_BUTTON_MASKS,
	BROWSER_WAIT_POLL_INTERVAL_MS,
} from './constants.js'
import { BrowserError, BrowserResultLimitError } from './errors.js'

/**
 * Decode a base64-encoded string into raw bytes.
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
 * Encode raw bytes as base64 without relying on Node or DOM globals.
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

/** Encode UTF-8 text as bytes. */
export function textToBytes(value: string): Uint8Array {
	return new TextEncoder().encode(value)
}

/** Decode UTF-8 bytes as text. */
export function bytesToText(value: Uint8Array): string {
	return new TextDecoder().decode(value)
}

/**
 * Convert a header record to Fetch-domain name/value entries.
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
 * Decode a Chromium Headers object into string values.
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
 * Decode one `Network.requestWillBeSent` or `Fetch.requestPaused` event.
 *
 * @param value - Unknown event parameters
 * @returns Request or undefined
 */
export function readBrowserRequest(value: unknown): BrowserRequest | undefined {
	if (!isRecord(value) || !isString(value['requestId']) || !isRecord(value['request'])) {
		return undefined
	}
	const request = value['request']
	if (!isString(request['url']) || !isString(request['method'])) {
		return undefined
	}
	const timestamp = isFiniteNumber(value['timestamp']) ? value['timestamp'] : undefined
	const walltime = isFiniteNumber(value['wallTime']) ? value['wallTime'] : undefined
	return {
		id: value['requestId'],
		loader: isString(value['loaderId']) ? value['loaderId'] : undefined,
		frame: isString(value['frameId']) ? value['frameId'] : undefined,
		url: request['url'],
		method: request['method'],
		headers: readBrowserHeaders(request['headers']),
		post: isString(request['postData']) ? request['postData'] : undefined,
		resource: isString(value['type'])
			? value['type']
			: isString(value['resourceType'])
				? value['resourceType']
				: undefined,
		timestamp,
		walltime,
		redirect: readBrowserResponseRecord(
			value['redirectResponse'],
			value['requestId'],
			isString(value['loaderId']) ? value['loaderId'] : '',
			isString(value['frameId']) ? value['frameId'] : undefined,
			timestamp ?? 0,
		),
	}
}

/**
 * Decode one `Network.responseReceived` event.
 *
 * @param value - Unknown event parameters
 * @returns Response or undefined
 */
export function readBrowserResponse(value: unknown): BrowserResponse | undefined {
	if (
		!isRecord(value) ||
		!isString(value['requestId']) ||
		!isString(value['loaderId']) ||
		!isFiniteNumber(value['timestamp'])
	) {
		return undefined
	}
	return readBrowserResponseRecord(
		value['response'],
		value['requestId'],
		value['loaderId'],
		isString(value['frameId']) ? value['frameId'] : undefined,
		value['timestamp'],
	)
}

/**
 * Decode one Chromium response object with its event identity.
 *
 * @param value - Unknown response object
 * @param id - Request id
 * @param loader - Loader id
 * @param frame - Optional frame id
 * @param timestamp - Monotonic event timestamp
 * @returns Response or undefined
 */
export function readBrowserResponseRecord(
	value: unknown,
	id: string,
	loader: string,
	frame: string | undefined,
	timestamp: number,
): BrowserResponse | undefined {
	if (
		!isRecord(value) ||
		!isString(value['url']) ||
		!isFiniteNumber(value['status']) ||
		!isString(value['statusText']) ||
		!isString(value['mimeType']) ||
		!isString(value['protocol']) ||
		!isFiniteNumber(timestamp)
	) {
		return undefined
	}
	return {
		id,
		loader,
		frame,
		url: value['url'],
		status: value['status'],
		phrase: value['statusText'],
		headers: readBrowserHeaders(value['headers']),
		mime: value['mimeType'],
		protocol: value['protocol'],
		address: isString(value['remoteIPAddress']) ? value['remoteIPAddress'] : undefined,
		port: isFiniteNumber(value['remotePort']) ? value['remotePort'] : undefined,
		cached: value['fromDiskCache'] === true || value['fromPrefetchCache'] === true,
		worker: value['fromServiceWorker'] === true,
		timestamp,
		timing: readBrowserTiming(value['timing']),
		security: readBrowserSecurity(value['securityDetails']),
	}
}

/**
 * Decode Chromium response timing.
 *
 * @param value - Unknown timing object
 * @returns Timing or undefined
 */
export function readBrowserTiming(value: unknown): BrowserTiming | undefined {
	if (!isRecord(value) || !isFiniteNumber(value['requestTime']) || value['requestTime'] < 0) {
		return undefined
	}
	const receive = value['receiveHeadersEnd']
	return {
		request: value['requestTime'],
		proxy: readBrowserTimingRange(value, 'proxyStart', 'proxyEnd'),
		dns: readBrowserTimingRange(value, 'dnsStart', 'dnsEnd'),
		connect: readBrowserTimingRange(value, 'connectStart', 'connectEnd'),
		ssl: readBrowserTimingRange(value, 'sslStart', 'sslEnd'),
		send: readBrowserTimingRange(value, 'sendStart', 'sendEnd'),
		receive: isFiniteNumber(receive) && receive >= 0 ? receive : undefined,
	}
}

/**
 * Decode one start/end pair from Chromium network timing data.
 *
 * @param value - Unknown timing object
 * @param start - Start field
 * @param end - End field
 * @returns Timing range or undefined
 */
export function readBrowserTimingRange(
	value: unknown,
	start: string,
	end: string,
): BrowserTimingRange | undefined {
	if (!isRecord(value)) return undefined
	const startValue = value[start]
	const endValue = value[end]
	if (
		!isFiniteNumber(startValue) ||
		startValue < 0 ||
		!isFiniteNumber(endValue) ||
		endValue < startValue
	) {
		return undefined
	}
	return { start: startValue, end: endValue }
}

/**
 * Build a standards-shaped HAR 1.2 entry from one observed exchange.
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
 * Convert HAR name/value headers into a Fetch-domain header record.
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
 * Validate the HAR 1.2 fields required for deterministic replay.
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
 * Decode Chromium TLS security details.
 *
 * @param value - Unknown security details
 * @returns Security metadata or undefined
 */
export function readBrowserSecurity(value: unknown): BrowserSecurity | undefined {
	if (
		!isRecord(value) ||
		!isString(value['protocol']) ||
		!isString(value['issuer']) ||
		!isFiniteNumber(value['validFrom']) ||
		!isFiniteNumber(value['validTo']) ||
		value['validTo'] < value['validFrom']
	) {
		return undefined
	}
	return {
		protocol: value['protocol'],
		issuer: value['issuer'],
		from: value['validFrom'],
		to: value['validTo'],
	}
}

/**
 * Decode one `Network.loadingFailed` event.
 *
 * @param value - Unknown event parameters
 * @returns Failure or undefined
 */
export function readBrowserRequestFailure(value: unknown): BrowserRequestFailure | undefined {
	if (!isRecord(value) || !isString(value['requestId']) || !isString(value['errorText'])) {
		return undefined
	}
	return {
		id: value['requestId'],
		error: value['errorText'],
		cancelled: value['canceled'] === true,
		blocked: isString(value['blockedReason']) ? value['blockedReason'] : undefined,
	}
}

/**
 * Decode one WebSocket frame event.
 *
 * @param value - Unknown event parameters
 * @returns Frame or undefined
 */
export function readBrowserWebSocketFrame(value: unknown): BrowserWebSocketFrame | undefined {
	if (!isRecord(value) || !isRecord(value['response']) || !isFiniteNumber(value['timestamp'])) {
		return undefined
	}
	const frame = value['response']
	if (!isInteger(frame['opcode']) || frame['opcode'] < 0 || !isString(frame['payloadData'])) {
		return undefined
	}
	return {
		opcode: frame['opcode'],
		data: frame['payloadData'],
		masked: frame['mask'] === true,
		timestamp: value['timestamp'],
	}
}

/**
 * Match a request against route criteria.
 *
 * @param request - Observed request
 * @param query - Match criteria
 * @returns Whether every supplied criterion matches
 */
export function matchesBrowserRoute(request: BrowserRequest, query: BrowserRouteQuery): boolean {
	if (query.method !== undefined && request.method !== query.method) return false
	if (query.resource !== undefined && request.resource !== query.resource) return false
	if (query.url === undefined) return true
	return matchesBrowserURL(request.url, query.url)
}

/**
 * Match a URL using Chromium-style `*` and `**` glob segments.
 *
 * @param url - Candidate URL
 * @param pattern - Glob pattern
 * @returns Whether the whole URL matches
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
 * Compile an auto-retrying in-page predicate wait.
 *
 * @param expression - Value or function expression
 * @param timeout - Maximum wait in milliseconds
 * @returns Promise expression resolving to the first truthy value or false
 */
export function compileFunctionWaitExpression(expression: string, timeout: number): string {
	return `new Promise((resolve, reject) => {
	const deadline = performance.now() + ${timeout}
	const predicate = (${expression})
	const check = async () => {
		try {
			const value = typeof predicate === 'function' ? await predicate() : await predicate
			if (value) {
				resolve(value)
				return
			}
			if (performance.now() >= deadline) {
				resolve(false)
				return
			}
			setTimeout(check, ${BROWSER_WAIT_POLL_INTERVAL_MS})
		} catch (error) {
			reject(error)
		}
	}
	void check()
})`
}

/**
 * Decode one Runtime binding invocation.
 *
 * @param value - Unknown `Runtime.bindingCalled` parameters
 * @returns Valid call or undefined
 */
export function readBrowserBindingCall(value: unknown): BrowserBindingCall | undefined {
	if (
		!isRecord(value) ||
		!isString(value['name']) ||
		!isString(value['payload']) ||
		!isInteger(value['executionContextId'])
	) {
		return undefined
	}
	const payload = parseJSON(value['payload'])
	if (
		!isRecord(payload) ||
		!isString(payload['id']) ||
		!isString(payload['name']) ||
		!isArray(payload['args']) ||
		payload['name'] !== value['name']
	) {
		return undefined
	}
	return {
		id: payload['id'],
		name: payload['name'],
		args: payload['args'],
		context: value['executionContextId'],
	}
}

/**
 * Compile the page-side promise facade for one Runtime binding.
 *
 * @param name - Binding identifier
 * @returns Self-installing script source
 */
export function compileBrowserBindingSource(name: string): string {
	const binding = JSON.stringify(name)
	const state = JSON.stringify(`__orkestrelBinding_${name}`)
	return `(() => {
	const name = ${binding}
	const key = ${state}
	if (globalThis[key]) return
	const send = globalThis[name]
	if (typeof send !== 'function') throw new Error('Browser binding transport is unavailable')
	const pending = new Map()
	let sequence = 0
	globalThis[key] = {
		resolve(id, success, value) {
			const entry = pending.get(id)
			if (!entry) return
			pending.delete(id)
			if (success) entry.resolve(value)
			else entry.reject(new Error(String(value)))
		},
	}
	globalThis[name] = (...args) => new Promise((resolve, reject) => {
		sequence += 1
		const id = String(sequence)
		pending.set(id, { resolve, reject })
		send(JSON.stringify({ id, name, args }))
	})
})()`
}

/**
 * Compile delivery of a host binding result to one execution context.
 *
 * @param name - Binding identifier
 * @param id - Call identifier
 * @param success - Resolve rather than reject
 * @param value - Serializable result or error
 * @returns Runtime expression
 */
export function compileBrowserBindingResult(
	name: string,
	id: string,
	success: boolean,
	value: unknown,
): string {
	return `globalThis[${JSON.stringify(`__orkestrelBinding_${name}`)}]?.resolve(${JSON.stringify(id)}, ${JSON.stringify(success)}, ${JSON.stringify(value)})`
}

/**
 * Compile current-document cleanup for one page-side host binding facade.
 *
 * @param name - Binding identifier
 * @returns Runtime cleanup expression
 */
export function compileBrowserBindingCleanup(name: string): string {
	return `(() => {
	delete globalThis[${JSON.stringify(name)}]
	delete globalThis[${JSON.stringify(`__orkestrelBinding_${name}`)}]
	return true
})()`
}

/**
 * Decode `Page.addScriptToEvaluateOnNewDocument` result.
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
 * Validate viewport input coordinates.
 *
 * @param point - Candidate point
 */
export function validateBrowserPoint(point: BrowserPoint): void {
	if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
		throw new BrowserError('Browser input coordinates must be finite', undefined, { point })
	}
}

/**
 * Validate shared trusted-input options.
 *
 * @param options - Candidate action options
 */
export function validateBrowserActionOptions(options?: BrowserActionOptions): void {
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
	if (options?.position !== undefined) validateBrowserPoint(options.position)
}

/**
 * Validate a public browser timeout before protocol work begins.
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
 * Validate Chromium viewport metrics.
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
 * Validate context emulation boundaries before partial application.
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
 * Validate isolated-context options before creating remote state.
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
 * Validate Accessibility-domain snapshot bounds.
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
 * Validate and compile Page.printToPDF parameters.
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
 * Validate and compile basic Page.captureScreenshot parameters.
 *
 * @param options - Public screenshot options
 * @returns Protocol parameter record
 */
export function browserScreenshotToParams(
	options?: BrowserScreenshotOptions,
): Readonly<Record<string, unknown>> {
	const format = options?.type ?? 'png'
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
 * Compile temporary animation, caret, and mask setup for a screenshot.
 *
 * @param options - Screenshot controls
 * @returns Setup expression or undefined when no preparation is required
 */
export function compileScreenshotPreparationExpression(
	options?: BrowserScreenshotOptions,
): string | undefined {
	const masks = options?.mask ?? []
	if (options?.animations !== false && options?.caret !== false && masks.length === 0) {
		return undefined
	}
	const queries = masks.map((locator) => compileLocatorListExpression(locator.query))
	return `(() => {
	const attribute = ${JSON.stringify(BROWSER_SCREENSHOT_ATTRIBUTE)}
	const sequence = (globalThis.__orkestrelScreenshotSequence ?? 0) + 1
	globalThis.__orkestrelScreenshotSequence = sequence
	const token = String(sequence)
	if (${JSON.stringify(options?.animations === false || options?.caret === false)}) {
		const style = document.createElement('style')
		style.setAttribute(attribute, token)
		style.textContent = ${JSON.stringify(
			`${options?.animations === false ? '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}' : ''}${options?.caret === false ? '*{caret-color:transparent!important}' : ''}`,
		)}
		document.documentElement.appendChild(style)
	}
	const groups = [${queries.join(',')}]
	for (const group of groups) {
		for (const element of group) {
			const rect = element.getBoundingClientRect()
			const mask = document.createElement('div')
			mask.setAttribute(attribute, token)
			mask.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;' +
				'left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;' +
				'background:' + ${JSON.stringify(options?.color ?? '#ff00ff')}
			document.documentElement.appendChild(mask)
		}
	}
	return token
})()`
}

/**
 * Compile cleanup for temporary screenshot styles and masks.
 *
 * @param token - Preparation token
 * @returns Cleanup expression
 */
export function compileScreenshotCleanupExpression(token: string): string {
	return `(() => {
	const attribute = ${JSON.stringify(BROWSER_SCREENSHOT_ATTRIBUTE)}
	for (const element of document.querySelectorAll('[' + attribute + ']')) {
		if (element.getAttribute(attribute) === ${JSON.stringify(token)}) element.remove()
	}
	return true
})()`
}

/**
 * Validate a finite numeric range.
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
 * Decode Accessibility-domain nodes into a flat serializable tree.
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
			role: readBrowserAXString(candidate['role']),
			name: readBrowserAXString(candidate['name']),
			description: readBrowserAXString(candidate['description']),
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
 * Decode an Accessibility-domain AXValue.
 *
 * @param value - Unknown AX value
 * @returns Underlying value
 */
export function readBrowserAXValue(value: unknown): unknown {
	return isRecord(value) && 'value' in value ? value['value'] : undefined
}

/**
 * Decode a string-valued Accessibility-domain AXValue.
 *
 * @param value - Unknown AX value
 * @returns String or undefined
 */
export function readBrowserAXString(value: unknown): string | undefined {
	const decoded = readBrowserAXValue(value)
	return isString(decoded) ? decoded : undefined
}

/**
 * Concatenate byte chunks without Node-specific buffers.
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
 * Decode one `IO.read` response.
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
 * Decode JavaScript precise coverage.
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
 * Decode CSS rule usage.
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
 * Decode coverage ranges.
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
 * Decode Performance-domain metrics.
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
 * Decode one CPU profile.
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
 * Decode a CPU profile call frame.
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
 * Convert a typed cookie input into Chromium protocol fields.
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
 * Decode cookies returned by `Storage.getCookies`.
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
 * Decode one Chromium cookie.
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
		partition: readBrowserCookiePartition(value['partitionKey']),
	}
}

/**
 * Match a decoded cookie against one request URL.
 *
 * @param cookie - Decoded context cookie
 * @param value - Candidate absolute URL
 * @returns Whether domain, path, and secure constraints match
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
 * Decode an optional Chromium cookie partition key.
 *
 * @param value - Unknown partition value
 * @returns Partition key or undefined
 */
export function readBrowserCookiePartition(value: unknown): BrowserCookiePartition | undefined {
	if (!isRecord(value) || !isString(value['topLevelSite'])) return undefined
	return {
		site: value['topLevelSite'],
		...(isBoolean(value['hasCrossSiteAncestor'])
			? { ancestor: value['hasCrossSiteAncestor'] }
			: {}),
	}
}

/**
 * Compile an expression that serializes local and session storage.
 *
 * @returns In-page storage expression
 */
export function compileStorageReadExpression(): string {
	return `({
	local: Array.from({ length: localStorage.length }, (_, index) => {
		const name = localStorage.key(index)
		return { name, value: name === null ? '' : localStorage.getItem(name) ?? '' }
	}),
	session: Array.from({ length: sessionStorage.length }, (_, index) => {
		const name = sessionStorage.key(index)
		return { name, value: name === null ? '' : sessionStorage.getItem(name) ?? '' }
	}),
})`
}

/**
 * Compile an expression that restores one origin's web storage.
 *
 * @param origin - Storage values to restore
 * @returns In-page restore expression
 */
export function compileStorageRestoreExpression(origin: BrowserStorageOrigin): string {
	return `(() => {
	const state = ${JSON.stringify({ local: origin.local, session: origin.session })}
	localStorage.clear()
	sessionStorage.clear()
	for (const entry of state.local) localStorage.setItem(entry.name, entry.value)
	for (const entry of state.session) sessionStorage.setItem(entry.name, entry.value)
	return true
})()`
}

/**
 * Compile an expression that clears local and session storage.
 *
 * @returns In-page clear expression
 */
export function compileStorageClearExpression(): string {
	return `(() => {
	localStorage.clear()
	sessionStorage.clear()
	return true
})()`
}

/**
 * Decode one in-page web-storage snapshot.
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
 * Decode a list of web-storage entries.
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
 * Convert typed media preferences to Chromium emulated media features.
 *
 * @param media - Public media configuration
 * @returns Protocol feature records
 */
export function mediaToFeatures(
	media: BrowserMedia,
): ReadonlyArray<Readonly<Record<string, string>>> {
	const features: Array<Readonly<Record<string, string>>> = []
	if (media.color !== undefined) features.push({ name: 'prefers-color-scheme', value: media.color })
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
 * Decode a Chromium runtime stack trace.
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
 * Decode one `Runtime.consoleAPICalled` event.
 *
 * @param value - Unknown event parameters
 * @returns Console message or undefined
 */
export function readBrowserConsoleMessage(value: unknown): BrowserConsoleMessage | undefined {
	if (
		!isRecord(value) ||
		!isString(value['type']) ||
		!isFiniteNumber(value['timestamp']) ||
		!isArray(value['args'])
	) {
		return undefined
	}
	const values = value['args'].map(readBrowserRemoteValue)
	return {
		level: value['type'],
		text: values
			.map((entry) => {
				if (isString(entry)) return entry
				const serialized = attempt<unknown>(() => JSON.stringify(entry))
				return serialized.success && isString(serialized.value) ? serialized.value : String(entry)
			})
			.join(' '),
		values,
		timestamp: value['timestamp'],
		stack: readBrowserStack(value['stackTrace']),
	}
}

/**
 * Decode a Runtime remote object's printable value.
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
 * Decode one `Runtime.exceptionThrown` event.
 *
 * @param value - Unknown event parameters
 * @returns Page error or undefined
 */
export function readBrowserPageError(value: unknown): BrowserPageError | undefined {
	if (!isRecord(value) || !isRecord(value['exceptionDetails'])) return undefined
	const details = value['exceptionDetails']
	const timestamp = isFiniteNumber(value['timestamp']) ? value['timestamp'] : Date.now()
	const exception = readBrowserRemoteValue(details['exception'])
	const message = isString(exception)
		? exception
		: isString(details['text'])
			? details['text']
			: 'Uncaught page exception'
	return {
		message,
		stack: readBrowserStack(details['stackTrace']),
		timestamp,
	}
}

/**
 * Decode one `Browser.downloadWillBegin` event.
 *
 * @param value - Unknown event parameters
 * @returns Download start or undefined
 */
export function readBrowserDownloadStart(value: unknown): BrowserDownloadStart | undefined {
	if (
		!isRecord(value) ||
		!isString(value['guid']) ||
		!isString(value['url']) ||
		!isString(value['suggestedFilename']) ||
		!isString(value['frameId'])
	) {
		return undefined
	}
	return {
		id: value['guid'],
		url: value['url'],
		name: value['suggestedFilename'],
		frame: value['frameId'],
	}
}

/**
 * Decode one `Browser.downloadProgress` event.
 *
 * @param value - Unknown event parameters
 * @returns Download id and progress, or undefined
 */
export function readBrowserDownloadProgress(
	value: unknown,
): readonly [id: string, progress: BrowserDownloadProgress] | undefined {
	if (
		!isRecord(value) ||
		!isString(value['guid']) ||
		!isFiniteNumber(value['receivedBytes']) ||
		value['receivedBytes'] < 0 ||
		!isFiniteNumber(value['totalBytes']) ||
		value['totalBytes'] < 0
	) {
		return undefined
	}
	const state = parseEnum(value['state'], ['completed', 'canceled', 'inProgress'])
	const status =
		state === 'completed'
			? 'complete'
			: state === 'canceled'
				? 'cancelled'
				: state === 'inProgress'
					? 'pending'
					: undefined
	if (status === undefined) return undefined
	return [
		value['guid'],
		{
			status,
			received: value['receivedBytes'],
			total: value['totalBytes'],
			...(isString(value['filePath']) ? { path: value['filePath'] } : {}),
		},
	]
}

/**
 * Wrap a `Runtime.evaluate` expression so the IN-PAGE code stringifies its
 * own result and throws a recognizable error before an oversized result
 * would overflow the CDP transport frame.
 *
 * @remarks
 * A result whose `JSON.stringify` length exceeds `limit` throws
 * `Error('BROWSER_RESULT_LIMIT: <length>')` inside the page instead of being
 * returned — the caller maps that sentinel to a coded
 * {@link BrowserResultLimitError}. A non-serializable result (`undefined`,
 * a function, a symbol) makes `JSON.stringify` return `undefined`, so the
 * length check is skipped and today's undefined-passthrough behavior is
 * unchanged.
 *
 * The expression is placed on its own line inside the wrapper (rather than
 * inline with the guard code) so a trailing `//` line comment in the
 * expression cannot swallow the closing guard syntax that follows it.
 *
 * @param expression - The candidate JavaScript expression to evaluate
 * @param limit - Maximum serialized-character length (see {@link BROWSER_RESULT_LIMIT})
 * @returns The wrapped, guarded expression
 */
export function guardEvaluateExpression(expression: string, limit: number): string {
	return `(() => { const r = (
${expression}
); const s = JSON.stringify(r); if (typeof s === 'string' && s.length > ${limit}) throw new Error(${JSON.stringify(BROWSER_RESULT_LIMIT_SENTINEL_PREFIX)} + s.length); return r })()`
}

/**
 * Decode one CDP `Runtime.evaluate` result.
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
 * Require an evaluated browser value to be a string.
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
 * Normalize a raw list of recorded codegen actions.
 *
 * @remarks
 * Collapses consecutive `fill` actions on the same selector into the latest
 * value (a text input fires one `input` event per keystroke) so the
 * compiled script reflects the final typed value rather than every
 * intermediate keystroke.
 *
 * @param actions - Raw recorded actions, in capture order
 * @returns Normalized actions, in the same order
 */
export function normalizeCodegenActions(
	actions: readonly BrowserCodegenAction[],
): readonly BrowserCodegenAction[] {
	const result: BrowserCodegenAction[] = []

	for (const action of actions) {
		const previous = result[result.length - 1]
		if (
			previous !== undefined &&
			previous.action === 'fill' &&
			action.action === 'fill' &&
			previous.selector === action.selector
		) {
			result[result.length - 1] = action
			continue
		}
		result.push(action)
	}

	return result
}

/**
 * Parse a codegen binding payload into a typed action.
 *
 * @remarks
 * The in-page recorder script calls the CDP binding with a JSON string
 * payload shaped like a {@link BrowserCodegenAction}. Returns `undefined`
 * when the payload is not valid JSON or does not match a known action shape.
 *
 * @param payload - Raw binding call payload (the CDP `payload` param)
 * @returns The parsed action, or `undefined` when the payload is malformed
 */
export function parseCodegenActionPayload(payload: unknown): BrowserCodegenAction | undefined {
	if (!isString(payload)) return undefined
	const parsed = parseJSON(payload)
	if (!isRecord(parsed)) return undefined

	const action = parseEnum(parsed['action'], ['click', 'fill', 'select'])
	const selector = parsed['selector']

	if (action === 'click' && isString(selector)) {
		return { action: 'click', selector }
	}

	if (action === 'fill' && isString(selector) && isString(parsed['value'])) {
		return { action: 'fill', selector, value: parsed['value'] }
	}

	if (action === 'select' && isString(selector)) {
		const values = parseArray(parsed['values'], isString)
		if (values !== undefined) return { action: 'select', selector, values }
	}

	return undefined
}

/**
 * Derive a `navigate` codegen action from a `Page.frameNavigated` CDP event.
 *
 * @remarks
 * Only the top-level (main) frame's navigation is recorded — a frame
 * carrying a `parentId` is a sub-frame and is ignored.
 *
 * @param params - The CDP `Page.frameNavigated` event params
 * @returns A `navigate` action, or `undefined` when the event is not a
 *   top-level navigation with a resolvable URL
 */
export function readCodegenNavigateAction(
	params: Readonly<Record<string, unknown>>,
): BrowserCodegenAction | undefined {
	const frame = params['frame']
	if (!isRecord(frame)) return undefined
	if ('parentId' in frame) return undefined
	if (!isString(frame['url'])) return undefined

	return { action: 'navigate', url: frame['url'] }
}

/**
 * Compile recorded codegen actions into a replayable script.
 *
 * @remarks
 * Emits one statement per action against a `page` object shaped like
 * {@link BrowserPageInterface} (`page.navigate(...)`, `page.click(...)`, …).
 * Both target languages emit an `async function run(page)` body whose
 * statements are `await`-ed; `language` only toggles whether the `page`
 * parameter carries a TypeScript type annotation (default `'javascript'`).
 *
 * @param actions - Normalized actions to compile
 * @param options - Compilation options (target language)
 * @returns The compiled script source
 */
export function compileCodegenScript(
	actions: readonly BrowserCodegenAction[],
	options?: BrowserCodegenScriptOptions,
): string {
	const language = options?.language ?? 'javascript'

	const lines = actions.map((action) => {
		switch (action.action) {
			case 'navigate':
				return `await page.navigate(${JSON.stringify(action.url)})`
			case 'click':
				return `await page.click(${JSON.stringify(action.selector)})`
			case 'fill':
				return `await page.fill(${JSON.stringify(action.selector)}, ${JSON.stringify(action.value)})`
			case 'select':
				return `await page.select(${JSON.stringify(action.selector)}, ${JSON.stringify(action.values)})`
		}
	})

	if (language === 'typescript') {
		return [
			`async function run(page: import('@orkestrel/browser').BrowserPageInterface): Promise<void> {`,
			...lines.map((line) => `\t${line}`),
			`}`,
		].join('\n')
	}

	return [`async function run(page) {`, ...lines.map((line) => `\t${line}`), `}`].join('\n')
}

/**
 * Decode a flattened CDP `Page.getFrameTree` result.
 *
 * @param value - Unknown CDP result
 * @returns Frame metadata in depth-first, main-frame-first order
 */
export function readBrowserFrames(value: unknown): readonly BrowserFrameInfo[] {
	if (!isRecord(value) || !isRecord(value['frameTree'])) return []

	const frames: BrowserFrameInfo[] = []
	const stack: Array<Readonly<Record<string, unknown>>> = [value['frameTree']]

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

	return frames
}

/**
 * Compile a deep, shadow-aware locator query returning every match.
 *
 * @param query - Serializable locator query
 * @returns Runtime expression returning an element array
 */
export function compileLocatorListExpression(query: BrowserQuery): string {
	return `(() => {
	const query = ${JSON.stringify(query)}
	const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim()
	const matchesText = (actual, expected, exact) => exact ? normalize(actual) === normalize(expected) : normalize(actual).includes(normalize(expected))
	const elements = (root) => {
		const found = []
		const stack = []
		if (root instanceof Document || root instanceof ShadowRoot) {
			for (let index = root.children.length - 1; index >= 0; index -= 1) stack.push(root.children[index])
		} else {
			for (let index = root.children.length - 1; index >= 0; index -= 1) stack.push(root.children[index])
		}
		while (stack.length > 0) {
			const element = stack.pop()
			if (!(element instanceof Element)) continue
			found.push(element)
			if (element.shadowRoot) {
				for (let index = element.shadowRoot.children.length - 1; index >= 0; index -= 1) stack.push(element.shadowRoot.children[index])
			}
			for (let index = element.children.length - 1; index >= 0; index -= 1) stack.push(element.children[index])
		}
		return found
	}
	const roleOf = (element) => {
		const explicit = element.getAttribute('role')
		if (explicit) return explicit.split(/\\s+/)[0]
		const tag = element.tagName.toLowerCase()
		if (tag === 'a' && element.hasAttribute('href')) return 'link'
		if (tag === 'button') return 'button'
		if (tag === 'textarea') return 'textbox'
		if (tag === 'select') return element.multiple ? 'listbox' : 'combobox'
		if (tag === 'option') return 'option'
		if (tag === 'img') return 'img'
		if (tag === 'nav') return 'navigation'
		if (tag === 'main') return 'main'
		if (tag === 'header') return 'banner'
		if (tag === 'footer') return 'contentinfo'
		if (tag === 'aside') return 'complementary'
		if (tag === 'article') return 'article'
		if (tag === 'form') return 'form'
		if (tag === 'table') return 'table'
		if (tag === 'tr') return 'row'
		if (tag === 'th') return 'columnheader'
		if (tag === 'td') return 'cell'
		if (tag === 'ul' || tag === 'ol') return 'list'
		if (tag === 'li') return 'listitem'
		if (/^h[1-6]$/.test(tag)) return 'heading'
		if (tag === 'input') {
			const type = (element.getAttribute('type') || 'text').toLowerCase()
			if (type === 'checkbox') return 'checkbox'
			if (type === 'radio') return 'radio'
			if (type === 'range') return 'slider'
			if (type === 'number') return 'spinbutton'
			if (type === 'button' || type === 'submit' || type === 'reset') return 'button'
			if (type !== 'hidden') return 'textbox'
		}
		return undefined
	}
	const labelOf = (element) => {
		const labelled = element.getAttribute('aria-labelledby')
		if (labelled) {
			const text = labelled.split(/\\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent || '').join(' ')
			if (normalize(text)) return normalize(text)
		}
		if (element.hasAttribute('aria-label')) return normalize(element.getAttribute('aria-label'))
		if ('labels' in element && element.labels && element.labels.length > 0) {
			const text = Array.from(element.labels, (label) => label.textContent || '').join(' ')
			return normalize(text)
		}
		return undefined
	}
	const nameOf = (element) => {
		const label = labelOf(element)
		if (label !== undefined) return label
		const alt = element.getAttribute('alt')
		if (alt) return normalize(alt)
		const title = element.getAttribute('title')
		if (title) return normalize(title)
		if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type)) return normalize(element.value)
		return normalize(element.textContent)
	}
	const visible = (element) => {
		const style = getComputedStyle(element)
		const rect = element.getBoundingClientRect()
		return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0
	}
	const resolve = (candidate) => {
		const roots = candidate.parent ? resolve(candidate.parent) : [document]
		let found = []
		for (const root of roots) {
			const candidates = elements(root)
			switch (candidate.selector) {
				case 'css':
					found.push(...candidates.filter((element) => element.matches(candidate.value)))
					break
				case 'role':
					found.push(...candidates.filter((element) => roleOf(element) === candidate.value && (candidate.name === undefined || matchesText(nameOf(element), candidate.name, candidate.exact === true))))
					break
				case 'text':
					found.push(...candidates.filter((element) => matchesText(element.textContent, candidate.value, candidate.exact === true) && !Array.from(element.children).some((child) => matchesText(child.textContent, candidate.value, candidate.exact === true))))
					break
				case 'label':
					found.push(...candidates.filter((element) => {
						const label = labelOf(element)
						return label !== undefined && matchesText(label, candidate.value, candidate.exact === true)
					}))
					break
				case 'placeholder':
					found.push(...candidates.filter((element) => matchesText(element.getAttribute('placeholder'), candidate.value, candidate.exact === true)))
					break
				case 'test':
					found.push(...candidates.filter((element) => element.getAttribute(${JSON.stringify(BROWSER_TEST_ID_ATTRIBUTE)}) === candidate.value))
					break
			}
		}
		found = found.filter((element, index) => found.indexOf(element) === index)
		if (candidate.filter?.text !== undefined) found = found.filter((element) => matchesText(element.textContent, candidate.filter.text, candidate.filter.exact === true))
		if (candidate.filter?.visible !== undefined) found = found.filter((element) => visible(element) === candidate.filter.visible)
		if (candidate.index !== undefined) {
			const index = candidate.index < 0 ? found.length + candidate.index : candidate.index
			return found[index] ? [found[index]] : []
		}
		return found
	}
	return resolve(query)
})()`
}

/**
 * Compile a deep locator query returning its first match.
 *
 * @param query - Serializable locator query
 * @returns Runtime expression returning one element or undefined
 */
export function compileLocatorExpression(query: BrowserQuery): string {
	return `(${compileLocatorListExpression(query)})[0]`
}

/**
 * Compile an attached-state locator wait.
 */
export function compileAttachedLocatorWaitExpression(
	query: BrowserQuery,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const deadline = performance.now() + ${timeout}
	const check = () => {
		const matches = ${compileLocatorListExpression(query)}
		if (${JSON.stringify(strict)} && matches.length > 1) {
			reject(new Error('Strict locator matched ' + matches.length + ' elements'))
			return true
		}
		if (matches.length > 0) {
			resolve(true)
			return true
		}
		if (performance.now() >= deadline) {
			resolve(false)
			return true
		}
		return false
	}
	if (check()) return
	const timer = setInterval(() => {
		if (!check()) return
		clearInterval(timer)
	}, 50)
})`
}

/**
 * Compile a detached-state locator wait.
 */
export function compileDetachedLocatorWaitExpression(
	query: BrowserQuery,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const deadline = performance.now() + ${timeout}
	const check = () => {
		const matches = ${compileLocatorListExpression(query)}
		if (${JSON.stringify(strict)} && matches.length > 1) {
			reject(new Error('Strict locator matched ' + matches.length + ' elements'))
			return true
		}
		if (matches.length === 0) {
			resolve(true)
			return true
		}
		if (performance.now() >= deadline) {
			resolve(false)
			return true
		}
		return false
	}
	if (check()) return
	const timer = setInterval(() => {
		if (!check()) return
		clearInterval(timer)
	}, 50)
})`
}

/**
 * Compile a visible-state locator wait.
 */
export function compileVisibleLocatorWaitExpression(
	query: BrowserQuery,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const deadline = performance.now() + ${timeout}
	const visible = (element) => {
		const style = getComputedStyle(element)
		const rect = element.getBoundingClientRect()
		return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0
	}
	const check = () => {
		const matches = ${compileLocatorListExpression(query)}
		if (${JSON.stringify(strict)} && matches.length > 1) {
			reject(new Error('Strict locator matched ' + matches.length + ' elements'))
			return true
		}
		if (matches.length > 0 && visible(matches[0])) {
			resolve(true)
			return true
		}
		if (performance.now() >= deadline) {
			resolve(false)
			return true
		}
		return false
	}
	if (check()) return
	const timer = setInterval(() => {
		if (!check()) return
		clearInterval(timer)
	}, 50)
})`
}

/**
 * Compile a hidden-state locator wait.
 */
export function compileHiddenLocatorWaitExpression(
	query: BrowserQuery,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const deadline = performance.now() + ${timeout}
	const visible = (element) => {
		const style = getComputedStyle(element)
		const rect = element.getBoundingClientRect()
		return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0
	}
	const check = () => {
		const matches = ${compileLocatorListExpression(query)}
		if (${JSON.stringify(strict)} && matches.length > 1) {
			reject(new Error('Strict locator matched ' + matches.length + ' elements'))
			return true
		}
		if (matches.length === 0 || matches.every((element) => !visible(element))) {
			resolve(true)
			return true
		}
		if (performance.now() >= deadline) {
			resolve(false)
			return true
		}
		return false
	}
	if (check()) return
	const timer = setInterval(() => {
		if (!check()) return
		clearInterval(timer)
	}, 50)
})`
}

/**
 * Compile the element-side actionability pass used before trusted input.
 *
 * @param options - Checks required for the action
 * @returns Async `Runtime.callFunctionOn` function declaration
 */
export function compileActionabilityFunction(options: BrowserActionabilityOptions): string {
	return `async function() {
	if (!(this instanceof Element) || !this.isConnected) throw new Error('Element is detached')
	this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
	const visible = () => {
		const style = getComputedStyle(this)
		const rect = this.getBoundingClientRect()
		return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0
	}
	if (${JSON.stringify(options.visible === true)} && !visible()) throw new Error('Element is not visible')
	if (${JSON.stringify(options.enabled === true)} && this.matches(':disabled')) throw new Error('Element is disabled')
	if (${JSON.stringify(options.editable === true)} && (this.matches('[readonly]') || (!this.isContentEditable && !('value' in this)))) throw new Error('Element is not editable')
	let previous
	for (let index = 0; index < ${BROWSER_STABLE_FRAME_COUNT}; index += 1) {
		await new Promise((resolve) => requestAnimationFrame(resolve))
		const rect = this.getBoundingClientRect()
		const current = [rect.x, rect.y, rect.width, rect.height]
		if (${JSON.stringify(options.stable === true)} && previous && current.some((value, part) => value !== previous[part])) {
			index = 0
		}
		previous = current
	}
	if (${JSON.stringify(options.events === true)}) {
		const rect = this.getBoundingClientRect()
		const position = ${JSON.stringify(options.position)}
		const x = rect.x + (position?.x ?? rect.width / 2)
		const y = rect.y + (position?.y ?? rect.height / 2)
		const target = this.ownerDocument.elementFromPoint(x, y)
		if (target !== this && !this.contains(target)) throw new Error('Element does not receive pointer events')
	}
	return true
}`
}

/**
 * Decode the first `DOM.getContentQuads` quad and its center.
 *
 * @param value - Unknown CDP result
 * @returns Decoded quad
 */
export function readBrowserQuad(value: unknown): BrowserQuad {
	if (!isRecord(value) || !isArray(value['quads'])) {
		throw new BrowserError('Element has no content quad')
	}
	const points = readNumberArray(value['quads'][0])
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
 * Parse a keyboard chord such as `Control+Shift+P`.
 *
 * @param value - Chord source
 * @returns Canonical modifiers and terminal key
 */
export function parseBrowserChord(value: string): BrowserChord {
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
 * Compute the CDP Input modifier bitmask.
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
 * Compute the CDP Input pressed-button bitmask.
 *
 * @param buttons - Currently pressed public mouse buttons
 * @returns Combined CDP pressed-button mask
 */
export function computeBrowserButtons(buttons: readonly BrowserMouseButton[]): number {
	let mask = 0
	for (const button of buttons) mask |= BROWSER_MOUSE_BUTTON_MASKS[button]
	return mask
}

/**
 * Normalize one key to CDP keyboard event data.
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
 * Compile an in-page wait for an attached selector.
 *
 * @param selector - CSS selector
 * @param strict - Whether more than one match is an error
 * @param timeout - Maximum wait in milliseconds
 * @returns Runtime expression resolving to whether the state was reached
 */
export function compileAttachedWaitExpression(
	selector: string,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const selector = ${JSON.stringify(selector)}
	const strict = ${JSON.stringify(strict)}
	const check = () => {
		const matches = document.querySelectorAll(selector)
		if (strict && matches.length > 1) {
			reject(new Error('Strict selector matched ' + matches.length + ' elements: ' + selector))
			return true
		}
		if (matches.length > 0) {
			resolve(true)
			return true
		}
		return false
	}
	if (check()) return
	const observer = new MutationObserver(() => {
		if (!check()) return
		observer.disconnect()
		clearTimeout(timer)
	})
	const timer = setTimeout(() => {
		observer.disconnect()
		resolve(false)
	}, ${timeout})
	observer.observe(document, { childList: true, subtree: true, attributes: true })
})`
}

/**
 * Compile an in-page wait for a detached selector.
 *
 * @param selector - CSS selector
 * @param strict - Whether more than one match is an error
 * @param timeout - Maximum wait in milliseconds
 * @returns Runtime expression resolving to whether the state was reached
 */
export function compileDetachedWaitExpression(
	selector: string,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const selector = ${JSON.stringify(selector)}
	const strict = ${JSON.stringify(strict)}
	const check = () => {
		const matches = document.querySelectorAll(selector)
		if (strict && matches.length > 1) {
			reject(new Error('Strict selector matched ' + matches.length + ' elements: ' + selector))
			return true
		}
		if (matches.length === 0) {
			resolve(true)
			return true
		}
		return false
	}
	if (check()) return
	const observer = new MutationObserver(() => {
		if (!check()) return
		observer.disconnect()
		clearTimeout(timer)
	})
	const timer = setTimeout(() => {
		observer.disconnect()
		resolve(false)
	}, ${timeout})
	observer.observe(document, { childList: true, subtree: true, attributes: true })
})`
}

/**
 * Compile an in-page wait for a visible selector.
 *
 * @param selector - CSS selector
 * @param strict - Whether more than one match is an error
 * @param timeout - Maximum wait in milliseconds
 * @returns Runtime expression resolving to whether the state was reached
 */
export function compileVisibleWaitExpression(
	selector: string,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const selector = ${JSON.stringify(selector)}
	const strict = ${JSON.stringify(strict)}
	const visible = (element) => {
		const style = getComputedStyle(element)
		const rect = element.getBoundingClientRect()
		return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0
	}
	const check = () => {
		const matches = document.querySelectorAll(selector)
		if (strict && matches.length > 1) {
			reject(new Error('Strict selector matched ' + matches.length + ' elements: ' + selector))
			return true
		}
		if (matches.length > 0 && visible(matches[0])) {
			resolve(true)
			return true
		}
		return false
	}
	if (check()) return
	const observer = new MutationObserver(() => {
		if (!check()) return
		observer.disconnect()
		clearTimeout(timer)
	})
	const timer = setTimeout(() => {
		observer.disconnect()
		resolve(false)
	}, ${timeout})
	observer.observe(document, { childList: true, subtree: true, attributes: true })
})`
}

/**
 * Compile an in-page wait for a hidden selector.
 *
 * @param selector - CSS selector
 * @param strict - Whether more than one match is an error
 * @param timeout - Maximum wait in milliseconds
 * @returns Runtime expression resolving to whether the state was reached
 */
export function compileHiddenWaitExpression(
	selector: string,
	strict: boolean,
	timeout: number,
): string {
	return `new Promise((resolve, reject) => {
	const selector = ${JSON.stringify(selector)}
	const strict = ${JSON.stringify(strict)}
	const visible = (element) => {
		const style = getComputedStyle(element)
		const rect = element.getBoundingClientRect()
		return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0
	}
	const check = () => {
		const matches = document.querySelectorAll(selector)
		if (strict && matches.length > 1) {
			reject(new Error('Strict selector matched ' + matches.length + ' elements: ' + selector))
			return true
		}
		if (matches.length === 0 || Array.from(matches).every((element) => !visible(element))) {
			resolve(true)
			return true
		}
		return false
	}
	if (check()) return
	const observer = new MutationObserver(() => {
		if (!check()) return
		observer.disconnect()
		clearTimeout(timer)
	})
	const timer = setTimeout(() => {
		observer.disconnect()
		resolve(false)
	}, ${timeout})
	observer.observe(document, { childList: true, subtree: true, attributes: true })
})`
}

/**
 * Compile a strict, visibility-checked click expression.
 *
 * @param selector - CSS selector
 * @param strict - Whether more than one match is an error
 * @returns Runtime expression
 */
export function compileClickExpression(selector: string, strict: boolean): string {
	return `(() => {
	const selector = ${JSON.stringify(selector)}
	const matches = document.querySelectorAll(selector)
	if (${JSON.stringify(strict)} && matches.length !== 1) throw new Error('Strict selector matched ' + matches.length + ' elements: ' + selector)
	const el = matches[0]
	if (!el) throw new Error('Element not found: ' + selector)
	const style = getComputedStyle(el)
	const rect = el.getBoundingClientRect()
	if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || rect.width <= 0 || rect.height <= 0) throw new Error('Element is not visible: ' + selector)
	if (el.matches(':disabled')) throw new Error('Element is disabled: ' + selector)
	el.scrollIntoView({ block: 'center', inline: 'center' })
	el.click()
})()`
}

/**
 * Compile a strict, editable fill expression.
 *
 * @param selector - CSS selector
 * @param value - Value to assign
 * @param strict - Whether more than one match is an error
 * @returns Runtime expression
 */
export function compileFillExpression(selector: string, value: string, strict: boolean): string {
	return `(() => {
	const selector = ${JSON.stringify(selector)}
	const matches = document.querySelectorAll(selector)
	if (${JSON.stringify(strict)} && matches.length !== 1) throw new Error('Strict selector matched ' + matches.length + ' elements: ' + selector)
	const el = matches[0]
	if (!el) throw new Error('Element not found: ' + selector)
	const style = getComputedStyle(el)
	const rect = el.getBoundingClientRect()
	if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || rect.width <= 0 || rect.height <= 0) throw new Error('Element is not visible: ' + selector)
	if (el.matches(':disabled') || el.matches('[readonly]')) throw new Error('Element is not editable: ' + selector)
	if (!el.isContentEditable && !('value' in el)) throw new Error('Element cannot be filled: ' + selector)
	el.focus()
	if (el.isContentEditable) {
		el.textContent = ${JSON.stringify(value)}
	} else {
		el.value = ${JSON.stringify(value)}
	}
	el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }))
	el.dispatchEvent(new Event('change', { bubbles: true }))
})()`
}

/**
 * Compile a strict select expression.
 *
 * @param selector - CSS selector
 * @param values - Option values to select
 * @param strict - Whether more than one match is an error
 * @returns Runtime expression
 */
export function compileSelectExpression(
	selector: string,
	values: readonly string[],
	strict: boolean,
): string {
	return `(() => {
	const selector = ${JSON.stringify(selector)}
	const matches = document.querySelectorAll(selector)
	if (${JSON.stringify(strict)} && matches.length !== 1) throw new Error('Strict selector matched ' + matches.length + ' elements: ' + selector)
	const el = matches[0]
	if (!el) throw new Error('Element not found: ' + selector)
	if (!(el instanceof HTMLSelectElement)) throw new Error('Element is not a select: ' + selector)
	if (el.disabled) throw new Error('Element is disabled: ' + selector)
	const values = ${JSON.stringify([...values])}
	if (!el.multiple && values.length > 1) throw new Error('Single select cannot accept multiple values: ' + selector)
	const available = new Set(Array.from(el.options, (option) => option.value))
	const missing = values.filter((value) => !available.has(value))
	if (missing.length > 0) throw new Error('Select options not found: ' + missing.join(', '))
	for (const opt of el.options) opt.selected = values.includes(opt.value)
	el.dispatchEvent(new Event('input', { bubbles: true }))
	el.dispatchEvent(new Event('change', { bubbles: true }))
})()`
}

/**
 * Read an unknown value as an all-number array.
 *
 * @param value - Candidate value
 * @returns The number array, or undefined
 */
export function readNumberArray(value: unknown): readonly number[] | undefined {
	if (!isArray(value) || !value.every(isFiniteNumber)) {
		return undefined
	}
	return value
}

/**
 * Resolve one index from a CDP snapshot string table.
 *
 * @param strings - Snapshot string table
 * @param index - Candidate string index
 * @returns The resolved string, or undefined
 */
export function readSnapshotString(strings: readonly string[], index: unknown): string | undefined {
	if (!isInteger(index)) return undefined
	return strings[index]
}

/**
 * Decode CDP snapshot sparse string data.
 *
 * @param value - Sparse `{ index, value }` record
 * @param strings - Snapshot string table
 * @returns Node-index to string map
 */
export function decodeRareStringData(
	value: unknown,
	strings: readonly string[],
): ReadonlyMap<number, string> {
	const decoded = new Map<number, string>()
	if (!isRecord(value)) return decoded
	const indexes = readNumberArray(value['index'])
	const values = readNumberArray(value['value'])
	if (indexes === undefined || values === undefined) return decoded

	for (let index = 0; index < indexes.length; index += 1) {
		const node = indexes[index]
		const text = readSnapshotString(strings, values[index])
		if (node !== undefined && text !== undefined) decoded.set(node, text)
	}
	return decoded
}

/**
 * Decode CDP snapshot sparse boolean data.
 *
 * @param value - Sparse `{ index }` record
 * @returns Set of node indexes whose value is true
 */
export function decodeRareBooleanData(value: unknown): ReadonlySet<number> {
	if (!isRecord(value)) return new Set()
	return new Set(readNumberArray(value['index']) ?? [])
}

/**
 * Decode CDP snapshot sparse integer data.
 *
 * @param value - Sparse `{ index, value }` record
 * @returns Node-index to integer map
 */
export function decodeRareIntegerData(value: unknown): ReadonlyMap<number, number> {
	const decoded = new Map<number, number>()
	if (!isRecord(value)) return decoded
	const indexes = readNumberArray(value['index'])
	const values = readNumberArray(value['value'])
	if (indexes === undefined || values === undefined) return decoded

	for (let index = 0; index < indexes.length; index += 1) {
		const node = indexes[index]
		const integer = values[index]
		if (node !== undefined && integer !== undefined) decoded.set(node, integer)
	}
	return decoded
}

/**
 * Decode a CDP snapshot rectangle.
 *
 * @param value - Candidate four-number array
 * @returns A rectangle, or undefined
 */
export function readBrowserRect(value: unknown): BrowserRect | undefined {
	const numbers = readNumberArray(value)
	if (numbers === undefined || numbers.length !== 4) return undefined
	const x = numbers[0]
	const y = numbers[1]
	const width = numbers[2]
	const height = numbers[3]
	if (x === undefined || y === undefined || width === undefined || height === undefined) {
		return undefined
	}
	return [x, y, width, height]
}

/**
 * Decode flattened CDP node attributes.
 *
 * @param value - Candidate string-index array
 * @param strings - Snapshot string table
 * @returns Frozen attribute record
 */
export function decodeBrowserAttributes(
	value: unknown,
	strings: readonly string[],
): Readonly<Record<string, string>> {
	const indexes = readNumberArray(value)
	const attributes: Record<string, string> = {}
	if (indexes === undefined) return Object.freeze(attributes)

	for (let index = 0; index < indexes.length; index += 2) {
		const name = readSnapshotString(strings, indexes[index])
		const attribute = readSnapshotString(strings, indexes[index + 1])
		if (name !== undefined && attribute !== undefined) attributes[name] = attribute
	}
	return Object.freeze(attributes)
}

/**
 * Decode a CDP `DOMSnapshot.captureSnapshot` result.
 *
 * @param value - Unknown CDP result
 * @param styles - Requested computed-style names, in protocol order
 * @param limit - Maximum accepted node count
 * @returns A typed serializable browser snapshot
 */
export function decodeBrowserSnapshot(
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
	if (!value['strings'].every(isString)) {
		throw new BrowserError('Malformed DOMSnapshot string table')
	}

	const strings: readonly string[] = value['strings']
	let count = 0
	for (const document of value['documents']) {
		if (!isRecord(document) || !isRecord(document['nodes'])) continue
		count += readNumberArray(document['nodes']['nodeType'])?.length ?? 0
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
		const frame = readSnapshotString(strings, rawDocument['frameId'])
		const url = readSnapshotString(strings, rawDocument['documentURL'])
		const title =
			rawDocument['title'] === -1 ? '' : readSnapshotString(strings, rawDocument['title'])
		if (frame === undefined || url === undefined || title === undefined) {
			throw new BrowserError('Malformed DOM snapshot document metadata', undefined, {
				document: documentIndex,
			})
		}
		const types = readNumberArray(rawNodes['nodeType'])
		const names = readNumberArray(rawNodes['nodeName'])
		const values = readNumberArray(rawNodes['nodeValue'])
		if (types === undefined || names === undefined || values === undefined) {
			throw new BrowserError('Malformed DOM snapshot node table', undefined, {
				document: documentIndex,
			})
		}

		const parents = readNumberArray(rawNodes['parentIndex']) ?? []
		const ids = readNumberArray(rawNodes['backendNodeId']) ?? []
		const rawAttributes = isArray(rawNodes['attributes']) ? rawNodes['attributes'] : []
		const texts = decodeRareStringData(rawNodes['textValue'], strings)
		const inputs = decodeRareStringData(rawNodes['inputValue'], strings)
		const checked = decodeRareBooleanData(rawNodes['inputChecked'])
		const selected = decodeRareBooleanData(rawNodes['optionSelected'])
		const clickable = decodeRareBooleanData(rawNodes['isClickable'])
		const shadows = decodeRareStringData(rawNodes['shadowRootType'], strings)
		const contents = decodeRareIntegerData(rawNodes['contentDocumentIndex'])
		const pseudos = decodeRareStringData(rawNodes['pseudoType'], strings)
		const sources = decodeRareStringData(rawNodes['currentSourceURL'], strings)
		const origins = decodeRareStringData(rawNodes['originURL'], strings)
		const layouts = new Map<number, BrowserLayout>()

		if (isRecord(rawDocument['layout'])) {
			const rawLayout = rawDocument['layout']
			const nodeIndexes = readNumberArray(rawLayout['nodeIndex']) ?? []
			const rawStyles = isArray(rawLayout['styles']) ? rawLayout['styles'] : []
			const rawBounds = isArray(rawLayout['bounds']) ? rawLayout['bounds'] : []
			const rawTexts = readNumberArray(rawLayout['text']) ?? []
			const paints = readNumberArray(rawLayout['paintOrders']) ?? []
			const rawOffsets = isArray(rawLayout['offsetRects']) ? rawLayout['offsetRects'] : []
			const rawScrolls = isArray(rawLayout['scrollRects']) ? rawLayout['scrollRects'] : []
			const rawClients = isArray(rawLayout['clientRects']) ? rawLayout['clientRects'] : []

			for (let layoutIndex = 0; layoutIndex < nodeIndexes.length; layoutIndex += 1) {
				const nodeIndex = nodeIndexes[layoutIndex]
				if (nodeIndex === undefined) continue
				const styleIndexes = readNumberArray(rawStyles[layoutIndex]) ?? []
				const computed: Record<string, string> = {}
				for (let styleIndex = 0; styleIndex < styles.length; styleIndex += 1) {
					const name = styles[styleIndex]
					const style = readSnapshotString(strings, styleIndexes[styleIndex])
					if (name !== undefined && style !== undefined) computed[name] = style
				}
				layouts.set(nodeIndex, {
					bounds: readBrowserRect(rawBounds[layoutIndex]),
					styles: Object.freeze(computed),
					text: readSnapshotString(strings, rawTexts[layoutIndex]),
					paint: paints[layoutIndex],
					offset: readBrowserRect(rawOffsets[layoutIndex]),
					scroll: readBrowserRect(rawScrolls[layoutIndex]),
					client: readBrowserRect(rawClients[layoutIndex]),
				})
			}
		}

		const nodes: BrowserNode[] = []
		for (let nodeIndex = 0; nodeIndex < types.length; nodeIndex += 1) {
			const type = types[nodeIndex]
			const name = readSnapshotString(strings, names[nodeIndex])
			const nodeValue =
				values[nodeIndex] === -1 ? '' : readSnapshotString(strings, values[nodeIndex])
			if (type === undefined || name === undefined || nodeValue === undefined) {
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
				type,
				name,
				value: nodeValue,
				attributes: decodeBrowserAttributes(rawAttributes[nodeIndex], strings),
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
 * Read one captured node attribute.
 *
 * @param node - Captured browser node
 * @param name - Attribute name
 * @returns Attribute value, or undefined
 */
export function attributeOfBrowserNode(node: BrowserNode, name: string): string | undefined {
	return node.attributes[name]
}

/**
 * Test whether a browser-node matcher is a declarative query.
 *
 * @param value - Browser-node query or predicate
 * @returns Whether the matcher is a declarative query
 *
 * @example
 * ```ts
 * import { isBrowserNodeQuery } from '@src/core'
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
 * Test a captured node against a declarative query.
 *
 * @param node - Captured browser node
 * @param query - Fields every candidate must satisfy
 * @returns Whether the node matches
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
 * Test whether a captured node has a non-empty rendered layout box.
 *
 * @param node - Captured browser node
 * @returns Whether the snapshot reports a visible layout box
 */
export function isBrowserNodeVisible(node: BrowserNode): boolean {
	const bounds = node.layout?.bounds
	return bounds !== undefined && bounds[2] > 0 && bounds[3] > 0
}
