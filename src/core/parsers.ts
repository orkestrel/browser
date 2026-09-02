import type {
	BrowserBindingCall,
	BrowserCodegenAction,
	BrowserConsoleMessage,
	BrowserCookiePartition,
	BrowserDownloadProgress,
	BrowserDownloadStart,
	BrowserPageError,
	BrowserRect,
	BrowserRequest,
	BrowserRequestFailure,
	BrowserResponse,
	BrowserSecurity,
	BrowserTiming,
	BrowserTimingRange,
	BrowserWebSocketFrame,
} from './types.js'
import {
	attempt,
	isArray,
	isBoolean,
	isFiniteNumber,
	isInteger,
	isRecord,
	isString,
	parseArray,
	parseEnum,
	parseJSON,
} from '@orkestrel/contract'
import {
	readBrowserAXValue,
	readBrowserHeaders,
	readBrowserRemoteValue,
	readBrowserStack,
} from './helpers.js'

/**
 * Coerces one `Network.requestWillBeSent` or `Fetch.requestPaused` event to a
 * `BrowserRequest`, or `undefined` off-shape.
 *
 * @param value - Unknown event parameters
 * @returns Request or undefined
 */
export function parseBrowserRequest(value: unknown): BrowserRequest | undefined {
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
		redirect: parseBrowserResponseRecord(
			value['redirectResponse'],
			value['requestId'],
			isString(value['loaderId']) ? value['loaderId'] : '',
			isString(value['frameId']) ? value['frameId'] : undefined,
			timestamp ?? 0,
		),
	}
}

/**
 * Coerces one `Network.responseReceived` event to a `BrowserResponse`, or
 * `undefined` off-shape.
 *
 * @param value - Unknown event parameters
 * @returns Response or undefined
 */
export function parseBrowserResponse(value: unknown): BrowserResponse | undefined {
	if (
		!isRecord(value) ||
		!isString(value['requestId']) ||
		!isString(value['loaderId']) ||
		!isFiniteNumber(value['timestamp'])
	) {
		return undefined
	}
	return parseBrowserResponseRecord(
		value['response'],
		value['requestId'],
		value['loaderId'],
		isString(value['frameId']) ? value['frameId'] : undefined,
		value['timestamp'],
	)
}

/**
 * Coerces one Chromium response object plus its event identity to a
 * `BrowserResponse`, or `undefined` off-shape.
 *
 * @param value - Unknown response object
 * @param id - Request id
 * @param loader - Loader id
 * @param frame - Optional frame id
 * @param timestamp - Monotonic event timestamp
 * @returns Response or undefined
 */
export function parseBrowserResponseRecord(
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
		timing: parseBrowserTiming(value['timing']),
		security: parseBrowserSecurity(value['securityDetails']),
	}
}

/**
 * Coerces Chromium response timing to a `BrowserTiming`, or `undefined`
 * off-shape.
 *
 * @param value - Unknown timing object
 * @returns Timing or undefined
 */
export function parseBrowserTiming(value: unknown): BrowserTiming | undefined {
	if (!isRecord(value) || !isFiniteNumber(value['requestTime']) || value['requestTime'] < 0) {
		return undefined
	}
	const receive = value['receiveHeadersEnd']
	return {
		request: value['requestTime'],
		proxy: parseBrowserTimingRange(value, 'proxyStart', 'proxyEnd'),
		dns: parseBrowserTimingRange(value, 'dnsStart', 'dnsEnd'),
		connect: parseBrowserTimingRange(value, 'connectStart', 'connectEnd'),
		ssl: parseBrowserTimingRange(value, 'sslStart', 'sslEnd'),
		send: parseBrowserTimingRange(value, 'sendStart', 'sendEnd'),
		receive: isFiniteNumber(receive) && receive >= 0 ? receive : undefined,
	}
}

/**
 * Coerces one named start/end pair of Chromium network timing to a
 * `BrowserTimingRange`, or `undefined` off-shape.
 *
 * @param value - Unknown timing object
 * @param start - Start field
 * @param end - End field
 * @returns Timing range or undefined
 */
export function parseBrowserTimingRange(
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
 * Coerces Chromium TLS security details to a `BrowserSecurity`, or `undefined`
 * off-shape.
 *
 * @param value - Unknown security details
 * @returns Security metadata or undefined
 */
export function parseBrowserSecurity(value: unknown): BrowserSecurity | undefined {
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
 * Coerces one `Network.loadingFailed` event to a `BrowserRequestFailure`, or
 * `undefined` off-shape.
 *
 * @param value - Unknown event parameters
 * @returns Failure or undefined
 */
export function parseBrowserRequestFailure(value: unknown): BrowserRequestFailure | undefined {
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
 * Coerces one WebSocket frame event to a `BrowserWebSocketFrame`, or
 * `undefined` off-shape.
 *
 * @param value - Unknown event parameters
 * @returns Frame or undefined
 */
export function parseBrowserWebSocketFrame(value: unknown): BrowserWebSocketFrame | undefined {
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
 * Coerces one Runtime binding invocation to a `BrowserBindingCall`, or
 * `undefined` off-shape.
 *
 * @param value - Unknown `Runtime.bindingCalled` parameters
 * @returns Valid call or undefined
 */
export function parseBrowserBindingCall(value: unknown): BrowserBindingCall | undefined {
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
 * Coerces a string-valued Accessibility-domain AXValue to a string, or
 * `undefined` off-shape.
 *
 * @param value - Unknown AX value
 * @returns String or undefined
 */
export function parseBrowserAXString(value: unknown): string | undefined {
	const decoded = readBrowserAXValue(value)
	return isString(decoded) ? decoded : undefined
}

/**
 * Coerces an optional Chromium cookie partition key to a
 * `BrowserCookiePartition`, or `undefined` off-shape.
 *
 * @param value - Unknown partition value
 * @returns Partition key or undefined
 */
export function parseBrowserCookiePartition(value: unknown): BrowserCookiePartition | undefined {
	if (!isRecord(value) || !isString(value['topLevelSite'])) return undefined
	return {
		site: value['topLevelSite'],
		...(isBoolean(value['hasCrossSiteAncestor'])
			? { ancestor: value['hasCrossSiteAncestor'] }
			: {}),
	}
}

/**
 * Coerces one `Runtime.consoleAPICalled` event to a `BrowserConsoleMessage`, or
 * `undefined` off-shape.
 *
 * @param value - Unknown event parameters
 * @returns Console message or undefined
 */
export function parseBrowserConsoleMessage(value: unknown): BrowserConsoleMessage | undefined {
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
 * Coerces one `Runtime.exceptionThrown` event to a `BrowserPageError`, or
 * `undefined` off-shape.
 *
 * @param value - Unknown event parameters
 * @returns Page error or undefined
 */
export function parseBrowserPageError(value: unknown): BrowserPageError | undefined {
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
 * Coerces one `Browser.downloadWillBegin` event to a `BrowserDownloadStart`, or
 * `undefined` off-shape.
 *
 * @param value - Unknown event parameters
 * @returns Download start or undefined
 */
export function parseBrowserDownloadStart(value: unknown): BrowserDownloadStart | undefined {
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
 * Coerces one `Browser.downloadProgress` event to a `BrowserDownloadProgress`,
 * or `undefined` off-shape.
 *
 * @param value - Unknown event parameters
 * @returns Download id and progress, or undefined
 */
export function parseBrowserDownloadProgress(
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
 * Coerces a codegen binding payload string to a `BrowserCodegenAction`, or
 * `undefined` off-shape.
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
 * Coerces a `Page.frameNavigated` CDP event to a `navigate` codegen action, or
 * `undefined` off-shape.
 *
 * @remarks
 * Only the top-level (main) frame's navigation is recorded — a frame
 * carrying a `parentId` is a sub-frame and is ignored.
 *
 * @param params - The CDP `Page.frameNavigated` event params
 * @returns A `navigate` action, or `undefined` when the event is not a
 *   top-level navigation with a resolvable URL
 */
export function parseCodegenNavigateAction(
	params: Readonly<Record<string, unknown>>,
): BrowserCodegenAction | undefined {
	const frame = params['frame']
	if (!isRecord(frame)) return undefined
	if ('parentId' in frame) return undefined
	if (!isString(frame['url'])) return undefined

	return { action: 'navigate', url: frame['url'] }
}

/**
 * Coerces an unknown value to an all-number array, or `undefined` off-shape.
 *
 * @param value - Candidate value
 * @returns The number array, or undefined
 */
export function parseNumberArray(value: unknown): readonly number[] | undefined {
	if (!isArray(value) || !value.every(isFiniteNumber)) {
		return undefined
	}
	return value
}

/**
 * Coerces one CDP snapshot string-table index to its string, or `undefined`
 * off-shape.
 *
 * @param strings - Snapshot string table
 * @param index - Candidate string index
 * @returns The resolved string, or undefined
 */
export function parseSnapshotString(
	strings: readonly string[],
	index: unknown,
): string | undefined {
	if (!isInteger(index)) return undefined
	return strings[index]
}

/**
 * Coerces a CDP snapshot rectangle to a `BrowserRect`, or `undefined`
 * off-shape.
 *
 * @param value - Candidate four-number array
 * @returns A rectangle, or undefined
 */
export function parseBrowserRect(value: unknown): BrowserRect | undefined {
	const numbers = parseNumberArray(value)
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
