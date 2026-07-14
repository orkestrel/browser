import type {
	Result,
	Success,
	Failure,
	QueueEntryStatus,
	EmailFormat,
	MimeHeader,
	MimePart,
	EmailAttachment,
	EmailMessage,
	MsgReaderInterface,
	BrowserEngine,
	BrowserConnection,
	BrowserStatus,
	BrowserWaitUntil,
	PlaywrightPageLike,
	PlaywrightContextLike,
	PlaywrightBrowserLike,
	PlaywrightEngineLike,
} from './types.js'
import { MIME_EXTENSIONS } from './constants.js'

// === Result Guards

/**
 * Narrow a Result to Success.
 *
 * @param result - Result to check
 * @returns True when result is Success
 */
export function isSuccess<T, E>(result: Result<T, E>): result is Success<T> {
	return result.success
}

/**
 * Narrow a Result to Failure.
 *
 * @param result - Result to check
 * @returns True when result is Failure
 */
export function isFailure<T, E>(result: Result<T, E>): result is Failure<E> {
	return !result.success
}

/**
 * Narrow an unknown value to a plain record.
 *
 * @param value - Value to check
 * @returns True when value is a non-null, non-array object
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrow an unknown value to a valid QueueEntryStatus.
 *
 * @param value - Value to check
 * @returns True when value is a recognized status string
 */
export function isQueueEntryStatus(value: unknown): value is QueueEntryStatus {
	return (
		value === 'pending' ||
		value === 'scheduled' ||
		value === 'active' ||
		value === 'completed' ||
		value === 'failed' ||
		value === 'aborted' ||
		value === 'expired'
	)
}

// === NodeWorker Guards

/**
 * Narrow an unknown value to a NodeWorker dispatch request.
 *
 * @param value - Value to check
 * @returns True when value has `id` (string) and `context` without a `type` field
 */
export function isNodeWorkerRequest(
	value: unknown,
): value is { readonly id: string; readonly context: unknown } {
	if (!isRecord(value)) return false
	if (typeof value.id !== 'string') return false
	if (!('context' in value)) return false
	return !('type' in value)
}

/**
 * Narrow an unknown value to a NodeWorker abort control message.
 *
 * @param value - Value to check
 * @returns True when value has `id` (string) and `type` === 'abort'
 */
export function isNodeWorkerAbortRequest(
	value: unknown,
): value is { readonly id: string; readonly type: 'abort' } {
	if (!isRecord(value)) return false
	return typeof value.id === 'string' && value.type === 'abort'
}

/**
 * Check whether an unknown outbound message is a result for a specific dispatch ID.
 *
 * @param value - Value to check
 * @param id - Expected dispatch ID
 * @returns True when value is a result-type message matching the ID
 */
export function isNodeWorkerResponseForId(value: unknown, id: string): boolean {
	if (!isRecord(value)) return false
	return value.type === 'result' && value.id === id
}

// === Msg Helpers

/**
 * Validate that a DataView starts with the CFB magic header.
 *
 * @param view - DataView to check
 * @returns True when the first 8 bytes match the CFB signature
 */
export function isMsgFile(view: DataView): boolean {
	const header = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]
	if (view.byteLength < header.length) return false
	for (let i = 0; i < header.length; i++) {
		if (view.getUint8(i) !== header[i]) return false
	}
	return true
}

/**
 * Remove trailing null characters from a string.
 *
 * @param text - Input string
 * @returns String with trailing nulls removed
 */
export function removeTrailingNull(text: string): string {
	const index = text.indexOf('\0')
	if (index !== -1) {
		return text.substring(0, index)
	}
	return text
}

/**
 * Read a UTF-16LE string from a DataView.
 *
 * @param view - DataView to read from
 * @param offset - Byte offset to start reading
 * @param charCount - Number of UTF-16 code units to read
 * @returns Decoded string
 */
export function readUtf16String(view: DataView, offset: number, charCount: number): string {
	let result = ''
	for (let i = 0; i < charCount; i++) {
		const code = view.getUint16(offset + i * 2, true)
		result += String.fromCharCode(code)
	}
	return result
}

/**
 * Read a Latin-1 (or custom encoding via TextDecoder) string from a Uint8Array.
 *
 * @param data - Binary data
 * @param encoding - Optional encoding label (default 'windows-1252')
 * @returns Decoded string
 */
export function readAnsiString(data: Uint8Array, encoding?: string): string {
	const label = encoding ?? 'windows-1252'
	try {
		const decoder = new TextDecoder(label)
		return decoder.decode(data)
	} catch {
		// Fallback to Latin-1 if encoding not supported
		let result = ''
		for (let i = 0; i < data.length; i++) {
			result += String.fromCharCode(data[i])
		}
		return result
	}
}

/**
 * Convert a Windows FILETIME (100-ns intervals since 1601-01-01) to a UTC date string.
 *
 * @param low - Low 32 bits of FILETIME
 * @param high - High 32 bits of FILETIME
 * @returns UTC date string
 */
export function fileTimeToUtcString(low: number, high: number): string {
	const fileTime = low + 4294967296.0 * high
	const unixMs = (fileTime - 116444736000000000) / 10000
	return new Date(unixMs).toUTCString()
}

/**
 * Convert a number to a lowercase hex string with specified padding.
 *
 * @param value - Number to convert
 * @param length - Minimum hex string length (zero-padded)
 * @returns Lowercase hex string
 */
export function toHexLower(value: number, length: number): string {
	const hex = '0123456789abcdef'
	let result = ''
	let remaining = value >>> 0
	for (let i = 0; i < length; i++) {
		result = hex[remaining & 15] + result
		remaining = remaining >>> 4
	}
	return result
}

/**
 * Stringify a mixed-endian Microsoft UUID from a byte array.
 *
 * @param data - Byte array containing the UUID
 * @param offset - Byte offset to start reading
 * @returns UUID string in lowercase
 */
export function msftUuidStringify(data: Uint8Array, offset: number): string {
	const hex = '0123456789abcdef'
	const b = (i: number) => hex[(data[offset + i] >> 4) & 15] + hex[data[offset + i] & 15]
	return (
		b(3) +
		b(2) +
		b(1) +
		b(0) +
		'-' +
		b(5) +
		b(4) +
		'-' +
		b(7) +
		b(6) +
		'-' +
		b(8) +
		b(9) +
		'-' +
		b(10) +
		b(11) +
		b(12) +
		b(13) +
		b(14) +
		b(15)
	)
}

// === MsgBurner Helpers

/**
 * Round a value up to the nearest multiple of a boundary.
 *
 * @param value - Number to round
 * @param boundary - Must be a power of 2
 * @returns Rounded value
 */
export function roundUpToMultiple(value: number, boundary: number): number {
	return (value + boundary - 1) & ~(boundary - 1)
}

/**
 * Compute how many sectors are needed to hold a given byte count.
 *
 * @param bytes - Total byte count
 * @param sectorSize - Sector size in bytes
 * @returns Number of sectors (0 when bytes ≤ 0)
 */
export function sectorsNeeded(bytes: number, sectorSize: number): number {
	if (bytes <= 0) return 0
	return roundUpToMultiple(bytes, sectorSize) / sectorSize
}

/**
 * CFB-compliant directory name comparator.
 * Compares by UTF-16 length first, then by uppercased code points.
 *
 * @param a - First name
 * @param b - Second name
 * @returns Negative, zero, or positive
 */
export function compareCfbName(a: string, b: string): number {
	const diff = a.length - b.length
	if (diff !== 0) return diff
	const x = a.toUpperCase()
	const y = b.toUpperCase()
	if (x > y) return 1
	if (x < y) return -1
	return 0
}

// === EmailParser Helpers

/**
 * Narrow an unknown value to a valid EmailFormat.
 *
 * @param value - Value to check
 * @returns True when value is 'eml' or 'msg'
 */
export function isEmailFormat(value: unknown): value is EmailFormat {
	return value === 'eml' || value === 'msg'
}

/**
 * Derive the EmailFormat from a File's name and MIME type.
 * Returns undefined when the format cannot be determined.
 *
 * @param file - File to inspect
 * @returns Detected format or undefined
 */
export function detectFormat(file: File): EmailFormat | undefined {
	const lower = file.name.toLowerCase()

	if (lower.endsWith('.eml')) return 'eml'
	if (lower.endsWith('.msg')) return 'msg'

	if (file.type === 'message/rfc822') return 'eml'
	if (file.type === 'application/vnd.ms-outlook') return 'msg'

	return undefined
}

/**
 * Parse headers from a raw RFC 2822 / MIME header text block.
 *
 * @param text - Raw header text
 * @returns Map of parsed header objects
 */
export function parseMimeHeaders(text: string): ReadonlyMap<string, MimeHeader> {
	const raw: Array<{ name: string; value: string }> = []

	for (const line of text.split('\n')) {
		if (line === '') continue
		if ((line.startsWith(' ') || line.startsWith('\t')) && raw.length > 0) {
			const last = raw[raw.length - 1]
			if (last !== undefined) {
				raw[raw.length - 1] = { name: last.name, value: last.value + ' ' + line.trim() }
			}
			continue
		}
		const colon = line.indexOf(':')
		if (colon === -1) continue
		raw.push({
			name: line.slice(0, colon).trim().toLowerCase(),
			value: line.slice(colon + 1).trim(),
		})
	}

	const map = new Map<string, MimeHeader>()
	for (const { name, value } of raw) {
		if (!map.has(name)) {
			const segments = value.split(';')
			const val = (segments[0] ?? '').trim()
			const params = new Map<string, string>()

			for (let i = 1; i < segments.length; i++) {
				const segment = (segments[i] ?? '').trim()
				const eq = segment.indexOf('=')
				if (eq === -1) continue
				const k = segment.slice(0, eq).trim().toLowerCase()
				let v = segment.slice(eq + 1).trim()
				if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
				params.set(k, v)
			}

			map.set(name, { value: val, params })
		}
	}
	return map
}

/**
 * Parse a raw RFC 2822 / MIME text string into a MimePart tree.
 * Line endings are normalised to \n before processing.
 *
 * @param raw - Raw MIME text
 * @returns Parsed MimePart tree
 */
export function parseMimePart(raw: string): MimePart {
	const normalised = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
	const split = normalised.indexOf('\n\n')
	const headerText = split === -1 ? normalised : normalised.slice(0, split)
	const body = split === -1 ? '' : normalised.slice(split + 2)

	const headers = parseMimeHeaders(headerText)
	const contentType = headers.get('content-type')
	const primaryType = (contentType?.value ?? '').split(';')[0].trim().toLowerCase()
	const boundary = contentType?.params.get('boundary') ?? ''

	const parts: MimePart[] = []
	if (primaryType.startsWith('multipart/') && boundary !== '') {
		const delimiter = '--' + boundary
		const lines = body.split('\n')
		let current: string[] = []
		let inside = false

		for (const line of lines) {
			const trimmed = line.trimEnd()
			if (trimmed === delimiter + '--') {
				if (inside && current.length > 0) parts.push(parseMimePart(current.join('\n')))
				inside = false
				break
			}
			if (trimmed === delimiter) {
				if (inside && current.length > 0) parts.push(parseMimePart(current.join('\n')))
				current = []
				inside = true
				continue
			}
			if (inside) current.push(line)
		}

		if (inside && current.length > 0) parts.push(parseMimePart(current.join('\n')))
	}

	return { headers, body, parts }
}

/**
 * Decode a MIME-encoded body string into a raw byte array.
 *
 * @param body - Raw encoded string
 * @param encoding - Encoding type (e.g., 'base64', 'quoted-printable')
 * @returns Decoded byte array
 */
export function decodeMimeEncoding(body: string, encoding: string): Uint8Array {
	const enc = encoding.toLowerCase()

	if (enc === 'base64') {
		const clean = body.replace(/\s+/g, '')
		const binary = atob(clean)
		const bytes = new Uint8Array(binary.length)
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i)
		}
		return bytes
	}

	if (enc === 'quoted-printable') {
		const unwrapped = body.replace(/=\r?\n/g, '')
		const result: number[] = []
		let i = 0

		while (i < unwrapped.length) {
			if (unwrapped[i] === '=' && i + 2 < unwrapped.length) {
				const hex = unwrapped.slice(i + 1, i + 3)
				const byte = parseInt(hex, 16)
				if (!isNaN(byte)) {
					result.push(byte)
					i += 3
					continue
				}
			}
			result.push(unwrapped.charCodeAt(i))
			i++
		}

		return new Uint8Array(result)
	}

	return new TextEncoder().encode(body)
}

/**
 * Decode a MIME-encoded body into a text string based on charset.
 *
 * @param body - Raw encoded string
 * @param encoding - Encoding type
 * @param charset - Character set (e.g., 'utf-8')
 * @returns Decoded string
 */
export function decodeMimeText(body: string, encoding: string, charset: string): string {
	const enc = encoding.toLowerCase()
	if (enc !== 'base64' && enc !== 'quoted-printable') {
		return body // Return directly for 7bit/8bit text
	}
	const bytes = decodeMimeEncoding(body, encoding)
	try {
		return new TextDecoder(charset || 'utf-8').decode(bytes)
	} catch {
		return new TextDecoder('utf-8').decode(bytes)
	}
}

/**
 * Decode RFC 2047 encoded words in header values.
 * Handles both Base64 (B) and Quoted-Printable (Q) forms.
 *
 * @param text - Header value string potentially containing encoded words
 * @returns Decoded string
 *
 * @example
 * ```ts
 * decodeMimeWords('=?UTF-8?B?SGVsbG8=?=') // 'Hello'
 * ```
 */
export function decodeMimeWords(text: string): string {
	return text.replace(
		/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
		(_match, charset: string, enc: string, encoded: string) => {
			try {
				const upper = enc.toUpperCase()
				const bytes =
					upper === 'B'
						? decodeMimeEncoding(encoded, 'base64')
						: decodeMimeEncoding(encoded.replace(/_/g, ' '), 'quoted-printable')
				return new TextDecoder(charset).decode(bytes)
			} catch {
				return encoded
			}
		},
	)
}

/**
 * Format a name and email into a standard composite address.
 *
 * @param name - Display name
 * @param email - Email address
 * @returns Formatted address string
 */
export function formatEmailAddress(name: string | undefined, email: string | undefined): string {
	const n = name?.trim() ?? ''
	const e = email?.trim() ?? ''
	if (n.length > 0 && e.length > 0) return `${n} <${e}>`
	if (n.length > 0) return n
	return e
}

/**
 * Extract a single EmailMessage from a parsed MsgReader.
 * Reads field data and attachments from the reader interface.
 *
 * @param reader - A parsed MsgReaderInterface instance
 * @returns Structured EmailMessage
 *
 * @throws When MsgReader reports a parse error
 */
export function extractMessageFromMsg(reader: MsgReaderInterface): EmailMessage {
	const data = reader.parse()

	if (data.error !== undefined) {
		throw new Error(data.error)
	}

	const from = formatEmailAddress(data.senderName, data.senderSmtpAddress ?? data.senderEmail)

	const recipients = data.recipients ?? []
	const to = recipients
		.filter((r) => r.recipientRole === 'to')
		.map((r) => formatEmailAddress(r.name, r.smtpAddress ?? r.email))
		.filter((s) => s.length > 0)
	const cc = recipients
		.filter((r) => r.recipientRole === 'cc')
		.map((r) => formatEmailAddress(r.name, r.smtpAddress ?? r.email))
		.filter((s) => s.length > 0)

	const rawDate = data.messageDeliveryTime ?? data.clientSubmitTime
	let date: Date | undefined
	if (rawDate !== undefined) {
		const parsed = new Date(rawDate)
		date = isNaN(parsed.getTime()) ? undefined : parsed
	}

	const attachments: EmailAttachment[] = []
	const attachmentFields = data.attachments ?? []
	for (let i = 0; i < attachmentFields.length; i++) {
		const attachment = attachmentFields[i]
		if (attachment === undefined) continue
		if (attachment.attachmentHidden === true) continue
		if (attachment.innerMsgContent === true) continue
		const extracted = reader.attachment(i)
		attachments.push({
			name: extracted.fileName,
			mimeType: attachment.mimeType ?? 'application/octet-stream',
			size: extracted.content.length,
			bytes: extracted.content,
		})
	}

	return {
		from,
		to,
		cc,
		subject: data.subject ?? '',
		date,
		text: data.body ?? '',
		html: data.bodyHtml ?? '',
		attachments,
	}
}

/**
 * Extract a single EmailMessage from a top-level MimePart.
 * Walks the full MIME tree to collect text, HTML, and attachments.
 *
 * @param part - Root MimePart from parseMimePart
 * @returns Structured EmailMessage
 */
export function extractMessage(part: MimePart): EmailMessage {
	const headerValue = (name: string): string => decodeMimeWords(part.headers.get(name)?.value ?? '')

	const splitAddresses = (raw: string): readonly string[] =>
		raw.length === 0
			? []
			: raw
					.split(',')
					.map((s) => s.trim())
					.filter((s) => s.length > 0)

	const rawDate = part.headers.get('date')?.value
	let date: Date | undefined
	if (rawDate !== undefined) {
		const parsed = new Date(rawDate)
		date = isNaN(parsed.getTime()) ? undefined : parsed
	}

	const collectedText: string[] = []
	const collectedHtml: string[] = []
	const attachments: EmailAttachment[] = []

	const walk = (p: MimePart) => {
		const contentType = p.headers.get('content-type')
		const disposition = p.headers.get('content-disposition')
		const transferEncoding = p.headers.get('content-transfer-encoding')

		const primaryType = (contentType?.value ?? 'text/plain').split(';')[0].trim().toLowerCase()
		const encoding = (transferEncoding?.value ?? '7bit').trim()
		const charset = contentType?.params.get('charset') ?? 'utf-8'
		const dispositionKind = (disposition?.value ?? '').trim().toLowerCase()

		if (primaryType.startsWith('multipart/')) {
			for (const child of p.parts) walk(child)
			return
		}

		const isAttachmentPart = dispositionKind === 'attachment'

		if (isAttachmentPart) {
			const name =
				disposition?.params.get('filename') ?? contentType?.params.get('name') ?? 'attachment'
			const bytes = decodeMimeEncoding(p.body, encoding)
			attachments.push({
				name: decodeMimeWords(name),
				mimeType: primaryType,
				size: bytes.length,
				bytes,
			})
			return
		}

		if (primaryType === 'text/plain') {
			collectedText.push(decodeMimeText(p.body, encoding, charset))
			return
		}

		if (primaryType === 'text/html') {
			collectedHtml.push(decodeMimeText(p.body, encoding, charset))
			return
		}

		// Inline binary parts with a filename become attachments
		const inlineName = contentType?.params.get('name') ?? disposition?.params.get('filename')
		if (inlineName !== undefined) {
			const bytes = decodeMimeEncoding(p.body, encoding)
			attachments.push({
				name: decodeMimeWords(inlineName),
				mimeType: primaryType,
				size: bytes.length,
				bytes,
			})
		}
	}

	walk(part)

	return {
		from: headerValue('from'),
		to: splitAddresses(headerValue('to')),
		cc: splitAddresses(headerValue('cc')),
		subject: headerValue('subject'),
		date,
		text: collectedText.join(''),
		html: collectedHtml.join(''),
		attachments,
	}
}

// === Attachment Helpers

/**
 * Infers the file extension for an attachment based on its filename or MIME type.
 * Returns the extension including the dot (e.g., '.jpg').
 */
export function inferExtension(mimeType?: string, fileName?: string): string {
	if (fileName !== undefined) {
		const lastDotIndex = fileName.lastIndexOf('.')
		if (lastDotIndex !== -1 && lastDotIndex < fileName.length - 1) {
			const ext = fileName.slice(lastDotIndex).toLowerCase()
			// Basic validation: extension should be alphanumeric and reasonably short
			if (/^\.[a-z0-9]{1,10}$/.test(ext)) {
				return ext
			}
		}
	}

	if (mimeType !== undefined) {
		const normalized = mimeType.split(';')[0]?.trim().toLowerCase()
		if (normalized !== undefined) {
			const ext = MIME_EXTENSIONS.get(normalized)
			if (ext !== undefined) return ext
		}
	}

	return '.bin'
}

// === Browser Guards

/**
 * Narrow an unknown value to BrowserEngine.
 *
 * @param value - Value to check
 * @returns True when value is a valid BrowserEngine
 */
export function isBrowserEngine(value: unknown): value is BrowserEngine {
	return value === 'chromium' || value === 'firefox' || value === 'webkit'
}

/**
 * Narrow an unknown value to BrowserStatus.
 *
 * @param value - Value to check
 * @returns True when value is a valid BrowserStatus
 */
export function isBrowserStatus(value: unknown): value is BrowserStatus {
	return (
		value === 'idle' ||
		value === 'connecting' ||
		value === 'connected' ||
		value === 'disconnected' ||
		value === 'error'
	)
}

/**
 * Narrow an unknown value to BrowserConnection.
 *
 * @param value - Value to check
 * @returns True when value is a valid BrowserConnection
 */
export function isBrowserConnection(value: unknown): value is BrowserConnection {
	return value === 'cdp' || value === 'launch' || value === 'persistent'
}

/**
 * Narrow an unknown value to BrowserWaitUntil.
 *
 * @param value - Value to check
 * @returns True when value is a valid BrowserWaitUntil
 */
export function isBrowserWaitUntil(value: unknown): value is BrowserWaitUntil {
	return (
		value === 'load' ||
		value === 'domcontentloaded' ||
		value === 'networkidle' ||
		value === 'commit'
	)
}

/**
 * Narrow an unknown value to PlaywrightPageLike.
 * Duck-type check validating the subset of Playwright methods used.
 *
 * @param value - Value to check
 * @returns True when value matches the PlaywrightPageLike shape
 */
export function isPlaywrightPageLike(value: unknown): value is PlaywrightPageLike {
	return (
		isRecord(value) &&
		typeof value['url'] === 'function' &&
		typeof value['title'] === 'function' &&
		typeof value['goto'] === 'function' &&
		typeof value['content'] === 'function' &&
		typeof value['evaluate'] === 'function' &&
		typeof value['click'] === 'function' &&
		typeof value['fill'] === 'function' &&
		typeof value['selectOption'] === 'function' &&
		typeof value['waitForSelector'] === 'function'
	)
}

/**
 * Narrow an unknown value to PlaywrightContextLike.
 *
 * @param value - Value to check
 * @returns True when value matches the PlaywrightContextLike shape
 */
export function isPlaywrightContextLike(value: unknown): value is PlaywrightContextLike {
	return (
		isRecord(value) &&
		typeof value['newPage'] === 'function' &&
		typeof value['pages'] === 'function' &&
		typeof value['close'] === 'function'
	)
}

/**
 * Narrow an unknown value to PlaywrightBrowserLike.
 *
 * @param value - Value to check
 * @returns True when value matches the PlaywrightBrowserLike shape
 */
export function isPlaywrightBrowserLike(value: unknown): value is PlaywrightBrowserLike {
	return (
		isRecord(value) &&
		typeof value['newContext'] === 'function' &&
		typeof value['contexts'] === 'function' &&
		typeof value['close'] === 'function' &&
		typeof value['isConnected'] === 'function'
	)
}

/**
 * Narrow an unknown value to PlaywrightEngineLike.
 *
 * @param value - Value to check
 * @returns True when value matches the PlaywrightEngineLike shape
 */
export function isPlaywrightEngineLike(value: unknown): value is PlaywrightEngineLike {
	return (
		isRecord(value) &&
		typeof value['connectOverCDP'] === 'function' &&
		typeof value['launch'] === 'function' &&
		typeof value['launchPersistentContext'] === 'function'
	)
}
