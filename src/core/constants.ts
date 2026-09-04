import type { BrowserMouseButton } from './types.js'

// === Base64
//
// The lookup table is written out rather than computed from BASE64_CHARS at module scope:
// constants.ts holds data, and a module-scope callback here is a placement violation the fleet
// policy sweep rejects. Entry n of the table is BASE64_CHARS[n], and the whole-alphabet
// round-trip in tests/src/core/helpers.test.ts fails on any single-entry disagreement.

/** Holds the index-ordered base64 alphabet used to build {@link BASE64_LOOKUP}. */
export const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Maps each base64 character to its 6-bit value, derived from {@link BASE64_CHARS}. */
export const BASE64_LOOKUP: Readonly<Record<string, number>> = Object.freeze({
	A: 0,
	B: 1,
	C: 2,
	D: 3,
	E: 4,
	F: 5,
	G: 6,
	H: 7,
	I: 8,
	J: 9,
	K: 10,
	L: 11,
	M: 12,
	N: 13,
	O: 14,
	P: 15,
	Q: 16,
	R: 17,
	S: 18,
	T: 19,
	U: 20,
	V: 21,
	W: 22,
	X: 23,
	Y: 24,
	Z: 25,
	a: 26,
	b: 27,
	c: 28,
	d: 29,
	e: 30,
	f: 31,
	g: 32,
	h: 33,
	i: 34,
	j: 35,
	k: 36,
	l: 37,
	m: 38,
	n: 39,
	o: 40,
	p: 41,
	q: 42,
	r: 43,
	s: 44,
	t: 45,
	u: 46,
	v: 47,
	w: 48,
	x: 49,
	y: 50,
	z: 51,
	'0': 52,
	'1': 53,
	'2': 54,
	'3': 55,
	'4': 56,
	'5': 57,
	'6': 58,
	'7': 59,
	'8': 60,
	'9': 61,
	'+': 62,
	'/': 63,
})

// === Browser

/** Sets the default timeout in milliseconds for browser connection, requests, and navigation. */
export const BROWSER_DEFAULT_TIMEOUT_MS = 30_000

/**
 * Caps the serialized-character length for an `evaluate()`/`content()` result,
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
 * Names the distinctive prefix for the in-page result-limit sentinel error, immediately
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

/** Sets the poll interval in milliseconds while waiting for a selector to appear. */
export const BROWSER_WAIT_POLL_INTERVAL_MS = 100

/** Sets the default maximum node count accepted from a decoded CDP DOM snapshot. */
export const BROWSER_SNAPSHOT_NODE_LIMIT = 100_000

/** Names the isolated world used for iframe evaluation. */
export const BROWSER_FRAME_WORLD_NAME = '__orkestrelBrowserFrame'

/** Names the attribute the semantic test-id selector uses. */
export const BROWSER_TEST_ID_ATTRIBUTE = 'data-testid'

/** Sets the number of animation frames whose element bounds must agree before trusted input. */
export const BROWSER_STABLE_FRAME_COUNT = 2

/**
 * Holds the in-page visibility predicate source, over a `style` computed style and a
 * `rect` bounding box already in scope at the interpolation site.
 *
 * @remarks
 * Every compiled expression that decides whether an element is visible
 * interpolates this one source, so what "visible" means has a single
 * definition rather than one copy per compiler.
 */
export const BROWSER_VISIBILITY_SOURCE =
	"style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0"

/** Maps a canonical modifier name to its CDP Input modifier bit value. */
export const BROWSER_KEY_MODIFIERS: Readonly<Record<string, number>> = Object.freeze({
	Alt: 1,
	Control: 2,
	Meta: 4,
	Shift: 8,
})

/** Maps each public mouse button to its CDP Input pressed-button bit value. */
export const BROWSER_MOUSE_BUTTON_MASKS: Readonly<Record<BrowserMouseButton, number>> =
	Object.freeze({
		left: 1,
		right: 2,
		middle: 4,
		back: 8,
		forward: 16,
	})

/**
 * Names the tool identity embedded in HAR 1.2 documents.
 *
 * @remarks
 * `version` is this package's own released version. A parity test in
 * `tests/src/core/BrowserHARManager.test.ts` compares it against the manifest,
 * so the archive stamp cannot drift away from the release that wrote it.
 */
export const BROWSER_HAR_CREATOR = Object.freeze({
	name: '@orkestrel/browser',
	version: '0.0.15',
})

/** Names the attribute that tags temporary screenshot styles and masks. */
export const BROWSER_SCREENSHOT_ATTRIBUTE = 'data-orkestrel-screenshot'

/**
 * Bounds (in milliseconds) the best-effort `Page.stopLoading` call issued
 * after a failed `navigate()`.
 *
 * @remarks
 * A wedged renderer can make the underlying CDP call hang for the full
 * per-call timeout; capping it to a small fixed bound keeps a navigate
 * failure's total latency close to the original timeout instead of doubling
 * it. Best-effort only — never masks the original navigate error.
 */
export const BROWSER_STOP_LOADING_TIMEOUT_MS = 1_000

/** Sets the default viewport width in pixels. */
export const BROWSER_DEFAULT_VIEWPORT_WIDTH = 1280

/** Sets the default viewport height in pixels. */
export const BROWSER_DEFAULT_VIEWPORT_HEIGHT = 720

// === Browser codegen

/** Names the CDP runtime binding the codegen recorder script calls into. */
export const BROWSER_CODEGEN_BINDING_NAME = '__orkestrelBrowserCodegen'

/**
 * Holds the in-page recorder script injected through `Page.addScriptToEvaluateOnNewDocument`
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
