// === Base64

/** Base64 alphabet, index-ordered, used to build {@link BASE64_LOOKUP}. */
export const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 character to 6-bit value lookup table, derived from {@link BASE64_CHARS}. */
export const BASE64_LOOKUP: Readonly<Record<string, number>> = Object.freeze(
	Object.fromEntries(BASE64_CHARS.split('').map((char, index) => [char, index])),
)

// === Browser

/** Default timeout in milliseconds for browser connection, requests, and navigation. */
export const BROWSER_DEFAULT_TIMEOUT_MS = 30_000

/**
 * Maximum serialized-character length for an `evaluate()`/`content()` result,
 * enforced IN-PAGE before the result is returned to CDP.
 *
 * @remarks
 * This counts UTF-16 STRING LENGTH (`String#length`), not transport BYTES —
 * the actual CDP frame is UTF-8 encoded (up to 3 bytes/char for common
 * multibyte content) and carries additional JSON/CDP framing overhead on top
 * of the raw content. A `Runtime.evaluate` result above this size, once
 * framed as a CDP JSON response, overflows the native WebSocket inbound frame
 * limit and closes the whole CDP connection — a page-level failure with no
 * clean error. The limit is set well under the observed ~3-4MB transport
 * ceiling (rather than at it) to leave headroom for the length-vs-bytes gap
 * and framing overhead. The cap is enforced by stringifying the candidate
 * result in-page and throwing a recognizable sentinel error (see
 * {@link BROWSER_RESULT_LIMIT_SENTINEL_PREFIX}) before the oversized frame is
 * ever produced, so the caller gets a coded error instead of a dropped
 * connection.
 */
export const BROWSER_RESULT_LIMIT = 2_500_000

/**
 * Distinctive prefix for the in-page result-limit sentinel error, immediately
 * followed by the serialized length.
 *
 * @remarks
 * Deliberately unlikely to appear in a page's own thrown error text (unlike
 * a plain `BROWSER_RESULT_LIMIT: ` label), so {@link BROWSER_RESULT_LIMIT_PATTERN}
 * can distinguish the guard's own throw from a page error that merely
 * mentions similar text.
 */
export const BROWSER_RESULT_LIMIT_SENTINEL_PREFIX = '[[ORKESTREL_BROWSER_RESULT_LIMIT]]'

/**
 * Matches the in-page result-limit sentinel error message, anchored
 * immediately after the `Error: ` (optionally `Uncaught Error: `) prefix that
 * Chromium prepends to a thrown error's description — so the guard's own
 * throw is recognized only at the message START, not wherever the substring
 * happens to occur.
 */
export const BROWSER_RESULT_LIMIT_PATTERN = new RegExp(
	`^(?:Uncaught )?Error: \\[\\[ORKESTREL_BROWSER_RESULT_LIMIT\\]\\](\\d+)`,
)

/** Poll interval in milliseconds while waiting for a selector to appear. */
export const BROWSER_WAIT_POLL_INTERVAL_MS = 100

/**
 * Bound (in milliseconds) on the best-effort `Page.stopLoading` call issued
 * after a failed `navigate()`.
 *
 * @remarks
 * A wedged renderer can make the underlying CDP call hang for the full
 * per-call timeout; capping it to a small fixed bound keeps a navigate
 * failure's total latency close to the original timeout instead of doubling
 * it. Best-effort only — never masks the original navigate error.
 */
export const BROWSER_STOP_LOADING_TIMEOUT_MS = 1_000

/** Default viewport width in pixels. */
export const BROWSER_DEFAULT_VIEWPORT_WIDTH = 1280

/** Default viewport height in pixels. */
export const BROWSER_DEFAULT_VIEWPORT_HEIGHT = 720

// === Browser codegen

/** Name of the CDP runtime binding the codegen recorder script calls into. */
export const BROWSER_CODEGEN_BINDING_NAME = '__orkestrelBrowserCodegen'

/**
 * In-page recorder script injected via `Page.addScriptToEvaluateOnNewDocument`
 * and `Runtime.evaluate`.
 *
 * @remarks
 * Attaches capturing-phase listeners for `click`, `input` (fill), and
 * `change` (select) on `document`, builds a stable CSS selector for the
 * target element, and forwards each action to the CDP binding
 * ({@link BROWSER_CODEGEN_BINDING_NAME}) as a JSON string payload. Guarded to
 * install exactly once per document (`window[name]` sentinel) so repeated
 * injection on every new document is idempotent.
 */
export const BROWSER_CODEGEN_SOURCE = `(() => {
	const bindingName = ${JSON.stringify(BROWSER_CODEGEN_BINDING_NAME)}
	if (window[bindingName + '__installed']) return
	window[bindingName + '__installed'] = true

	const selectorFor = (el) => {
		if (el.id) return '#' + CSS.escape(el.id)
		const parts = []
		let node = el
		while (node && node.nodeType === 1 && parts.length < 8) {
			let part = node.tagName.toLowerCase()
			if (node.classList && node.classList.length > 0) {
				part += '.' + Array.from(node.classList).map((cls) => CSS.escape(cls)).join('.')
			}
			const parent = node.parentElement
			if (parent) {
				const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName)
				if (siblings.length > 1) {
					part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')'
				}
			}
			parts.unshift(part)
			node = parent
		}
		return parts.join(' > ')
	}

	const send = (payload) => {
		if (typeof window[bindingName] === 'function') {
			window[bindingName](JSON.stringify(payload))
		}
	}

	document.addEventListener(
		'click',
		(event) => {
			const target = event.target
			if (!target || target.nodeType !== 1) return
			send({ action: 'click', selector: selectorFor(target) })
		},
		true,
	)

	const fillableTypes = new Set([
		'text',
		'search',
		'url',
		'tel',
		'email',
		'password',
		'number',
	])

	document.addEventListener(
		'input',
		(event) => {
			const target = event.target
			if (!target || target.nodeType !== 1) return

			if (target.isContentEditable) {
				send({ action: 'fill', selector: selectorFor(target), value: target.textContent || '' })
				return
			}

			if (typeof target.value !== 'string') return
			const tag = target.tagName
			if (tag === 'TEXTAREA') {
				send({ action: 'fill', selector: selectorFor(target), value: target.value })
				return
			}
			if (tag === 'INPUT' && fillableTypes.has((target.type || 'text').toLowerCase())) {
				send({ action: 'fill', selector: selectorFor(target), value: target.value })
			}
		},
		true,
	)

	document.addEventListener(
		'change',
		(event) => {
			const target = event.target
			if (!target || target.tagName !== 'SELECT') return
			const values = Array.from(target.selectedOptions || []).map((option) => option.value)
			send({ action: 'select', selector: selectorFor(target), values })
		},
		true,
	)
})()`
