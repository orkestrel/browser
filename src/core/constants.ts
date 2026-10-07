import type { ToolDefinition } from '@orkestrel/tool'
import type {
	BrowserElementRefusal,
	BrowserJourney,
	BrowserMouseButton,
	BrowserNavigationReason,
	BrowserNavigationStage,
	BrowserStepOutcome,
	BrowserToolName,
} from './types.js'

// === Browser

/**
 * Sets the default timeout for browser connection, requests, and navigation, `30_000`
 * milliseconds.
 */
export const BROWSER_DEFAULT_TIMEOUT_MS = 30_000

/**
 * Caps the serialized-character length for an `evaluate()`/`read()` result at `2_500_000`,
 * enforced in-page before the result is returned to CDP.
 *
 * @remarks
 * This counts UTF-16 string length (`String#length`), not transport bytes —
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
 * Names the distinctive prefix for the in-page result-limit sentinel error,
 * `'[[ORKESTREL_BROWSER_RESULT_LIMIT]]'`, immediately followed by the serialized length.
 *
 * @remarks
 * Deliberately unlikely to appear in a page's own thrown error text (unlike
 * a plain `BROWSER_RESULT_LIMIT: ` label), so {@link BROWSER_RESULT_LIMIT_PATTERN}
 * can distinguish the guard's own throw from a page error that merely
 * mentions similar text.
 */
export const BROWSER_RESULT_LIMIT_SENTINEL_PREFIX = '[[ORKESTREL_BROWSER_RESULT_LIMIT]]'

/**
 * Matches the in-page result-limit sentinel error message, anchored immediately after the
 * `Error:` (optionally `Uncaught Error:`) prefix Chromium prepends to a thrown error's
 * description, `/^(?:Uncaught )?Error: \[\[ORKESTREL_BROWSER_RESULT_LIMIT\]\](\d+)/`.
 *
 * @remarks
 * The anchor matches the guard's own throw only at the start of the message, rather than
 * wherever the substring happens to occur.
 */
export const BROWSER_RESULT_LIMIT_PATTERN = new RegExp(
	`^(?:Uncaught )?Error: \\[\\[ORKESTREL_BROWSER_RESULT_LIMIT\\]\\](\\d+)`,
)

/**
 * Sets the default maximum node count accepted from a decoded CDP DOM snapshot, `100_000`.
 */
export const BROWSER_SNAPSHOT_NODE_LIMIT = 100_000

/** Names the isolated world used for iframe evaluation, `'__orkestrelBrowserFrame'`. */
export const BROWSER_FRAME_WORLD_NAME = '__orkestrelBrowserFrame'

/** Sets the number of animation frames whose element bounds must agree before trusted input. */
export const BROWSER_STABLE_FRAME_COUNT = 2

/**
 * Names the finished transitions and animations that wake a parked wait.
 *
 * @remarks
 * Chromium 154.0.4258.53 delivers these events in main and isolated worlds after a
 * visibility or discrete display exit. Opacity alone leaves text in `innerText`.
 */
export const BROWSER_WAIT_EVENTS: readonly string[] = Object.freeze([
	'transitionend',
	'animationend',
])

/** Matches protocol errors caused by replacement or closure of an execution context. */
export const BROWSER_CONTEXT_LOSS_PATTERN =
	/execution context was destroyed|cannot find context with specified id|inspected target navigated or closed/i

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
	version: '0.0.26',
})

/** Names the attribute that tags temporary screenshot styles and masks. */
export const BROWSER_SCREENSHOT_ATTRIBUTE = 'data-orkestrel-screenshot'

/**
 * Lists every CDP `Page.ClientNavigationReason` value a page accepts as a navigation's reason, as
 * of Chromium 141; a page reads any other reason as undefined.
 */
export const BROWSER_NAVIGATION_REASONS: readonly BrowserNavigationReason[] = Object.freeze([
	'anchorClick',
	'formSubmissionGet',
	'formSubmissionPost',
	'httpHeaderRefresh',
	'initialFrameNavigation',
	'metaTagRefresh',
	'other',
	'pageBlockInterstitial',
	'reload',
	'scriptInitiated',
])

/**
 * Lists the CDP `Page.frameStartedNavigating` `navigationType` values that repeat or restore a
 * history entry rather than follow a request, as of Chromium 141.
 */
export const BROWSER_RELOAD_NAVIGATION_TYPES: readonly string[] = Object.freeze([
	'reload',
	'reloadBypassingCache',
	'restore',
	'restoreWithPost',
	'historySameDocument',
	'historyDifferentDocument',
])

/**
 * Names the isolated-world property that holds the `submit` observer an action installs before
 * its input, `'__orkestrelSubmit'`.
 */
export const BROWSER_SUBMIT_KEY = '__orkestrelSubmit'

/**
 * Bounds the best-effort `Page.stopLoading` call issued after a failed `navigate()` at `1_000`
 * milliseconds.
 *
 * @remarks
 * A wedged renderer can make the underlying CDP call hang for the full
 * per-call timeout; capping it to a small fixed bound keeps a navigate
 * failure's total latency close to the original timeout instead of doubling
 * it. Best-effort only — never masks the original navigate error.
 */
export const BROWSER_STOP_LOADING_TIMEOUT_MS = 1_000

/** Sets the default viewport width, `1280` pixels. */
export const BROWSER_DEFAULT_VIEWPORT_WIDTH = 1280

/** Sets the default viewport height, `720` pixels. */
export const BROWSER_DEFAULT_VIEWPORT_HEIGHT = 720

// === Browser codegen

/**
 * Names the CDP runtime binding the codegen recorder script calls into,
 * `'__orkestrelBrowserCodegen'`.
 */
export const BROWSER_CODEGEN_BINDING_NAME = '__orkestrelBrowserCodegen'

/**
 * Holds the self-contained document listener installed before a frame resumes.
 * Password input carries a marker; only Enter carries a key. Node indices are local to a document.
 */
export const BROWSER_CODEGEN_SOURCE = `(() => {
	const binding = '__orkestrelBrowserCodegen'
	window[binding + '__state']?.controller.abort()
	const state = { controller: new AbortController(), nodes: [], indices: new WeakMap() }
	window[binding + '__state'] = state
	for (const event of ['click', 'input', 'change', 'keydown', 'focusout', 'submit', 'contextmenu', 'drop']) {
		document.addEventListener(event, (event) => {
			if (!event.isTrusted || typeof window[binding] !== 'function') return
			if (event.type === 'keydown' && event.key !== 'Enter') return
			const element = event.composedPath()[0]
			if (!(element instanceof Element)) return
			let index = state.indices.get(element)
			if (index === undefined) {
				index = state.nodes.push(element) - 1
				state.indices.set(element, index)
			}
			const control = element.tagName === 'SELECT' ? (element.multiple ? 'multiple' : 'select')
				: element.tagName === 'OPTION' ? 'option'
				: element.tagName === 'INPUT' && element.type === 'password' ? 'password'
				: element.tagName === 'TEXTAREA' || element.isContentEditable ||
					(element.tagName === 'INPUT' && ['text', 'search', 'url', 'tel', 'email', 'number'].includes(element.type)) ? 'text' : 'other'
			const payload = { event: event.type, index, top: window === window.top && element.ownerDocument === document, control, form: !!element.form }
			if (event.type === 'click') payload.detail = event.detail
			if (event.type === 'keydown') payload.key = 'Enter'
			if (event.type === 'input' && control === 'password') payload.secret = true
			if (event.type === 'input' && control === 'text') payload.value = element.isContentEditable ? element.textContent || '' : element.value
			if (event.type === 'change' && control === 'select') {
				payload.value = element.value
				payload.roundtrip = Array.from(element.options).find(option => option.value === element.value) === element.selectedOptions[0]
			}
			if (element.getRootNode() !== document) {
				payload.event = 'unsupported'
				payload.gap = 'the element is in a shadow root'
			} else if (event.type === 'contextmenu' || event.type === 'drop' || (event.type === 'click' && (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) && !['select', 'multiple', 'option'].includes(control))) {
				payload.event = 'unsupported'
				payload.gap = 'an unsupported gesture'
			}
			window[binding](JSON.stringify(payload.event === 'unsupported' ? { event: payload.event, index, top: payload.top, control, form: payload.form, gap: payload.gap } : payload))
		}, { capture: true, signal: state.controller.signal })
	}
})()`

/** Identifies the CDP method-not-found response when WebMCP is absent. */
export const BROWSER_REGISTRY_ABSENT_CODE = -32601

/** Bounds adopted tool JSON output and error messages to 4096 UTF-16 code units. */
export const BROWSER_REGISTRY_OUTPUT_LIMIT = 4096
/** Prefixes stable element references within a browser context. */
export const BROWSER_REFERENCE_PREFIX = 'e'

/** Bounds the default number of actionable elements in an outline. */
export const BROWSER_OUTLINE_LIMIT = 150

/**
 * Matches one word of an outline search and of a row's role and name: a run of at least 3 letters
 * or digits.
 *
 * @remarks
 * The 3-character floor drops words such as `a`, `to`, and `of`, which would otherwise score a row
 * whose name shares them with the search.
 */
export const BROWSER_SEARCH_PATTERN = /[\p{L}\p{N}]{3,}/gu

/** Names accessibility roles that receive actionable outline references. */
export const BROWSER_INTERACTIVE_ROLES: ReadonlySet<string> = Object.freeze(
	new Set([
		'button',
		'link',
		'textbox',
		'searchbox',
		'combobox',
		'listbox',
		'option',
		'checkbox',
		'radio',
		'switch',
		'slider',
		'spinbutton',
		'menuitem',
		'menuitemcheckbox',
		'menuitemradio',
		'tab',
		'treeitem',
		'DisclosureTriangle',
		'PopUpButton',
		'ColorWell',
		'Date',
		'DateTime',
		'Time',
		'InputTime',
		'Iframe',
	]),
)

/**
 * Maps the first line of each refusal the compiled element functions throw, without its `Error: `
 * prefix, to the reason and the one-line detail an element action reports it with.
 *
 * @remarks
 * `compileActionabilityFunction` throws the detached, not-visible, disabled, not-editable, and
 * pointer-event refusals; `compileSelectFunction` throws the text-control, select-control, and
 * missing-option refusals.
 */
export const BROWSER_ELEMENT_REFUSALS: ReadonlyMap<string, BrowserElementRefusal> = Object.freeze(
	new Map<string, BrowserElementRefusal>([
		['Element is detached', { reason: 'GONE', detail: undefined }],
		['Element is not visible', { reason: 'HIDDEN', detail: 'is not visible' }],
		['Element is disabled', { reason: 'DISABLED', detail: 'is disabled' }],
		['Element is not editable', { reason: 'UNKNOWN', detail: 'is not editable' }],
		[
			'Element does not receive pointer events',
			{ reason: 'OCCLUDED', detail: 'does not receive pointer events' },
		],
		['Element is not a text control', { reason: 'UNKNOWN', detail: 'is not a text control' }],
		['Element is not a select control', { reason: 'UNKNOWN', detail: 'is not a select control' }],
		['Select option was not found', { reason: 'UNKNOWN', detail: 'has no such option' }],
	]),
)

/** Names accessibility roles whose own rows add no outline content. */
export const BROWSER_OUTLINE_OMITTED_ROLES: ReadonlySet<string> = Object.freeze(
	new Set(['none', 'generic', 'InlineTextBox', 'RootWebArea', 'WebArea']),
)

/** Names accessibility roles rendered as text without an actionable reference. */
export const BROWSER_TEXT_ROLES: ReadonlySet<string> = Object.freeze(
	new Set(['heading', 'StaticText']),
)

// === Browser toolset

/**
 * Bounds each tool result and error message at `4_000` UTF-16 code units including its footer.
 *
 * @remarks
 * A page tool's error message and JSON output reach the toolset already cut at
 * {@link BROWSER_REGISTRY_OUTPUT_LIMIT}, so a toolset limit over that shows at most
 * `4_096` characters of either.
 */
export const BROWSER_TOOL_LIMIT = 4_000

/**
 * Sets the `wait` tool's default and an action receipt's bound on a requested navigation,
 * `5_000` milliseconds.
 *
 * @remarks
 * The receipt's bound runs from the moment the receipt starts waiting for the requested
 * navigation, so the time an action spent queued and the load wait of an explicit `navigate`
 * precede it.
 */
export const BROWSER_TOOL_TIMEOUT_MS = 5_000

/**
 * Reserves `1_000` milliseconds of an action receipt's `BROWSER_TOOL_TIMEOUT_MS` deadline for the
 * view capture, so a receipt whose navigation wait reaches its bound still carries the view.
 */
export const BROWSER_TOOL_CAPTURE_MS = 1_000

/**
 * Holds the note an action receipt carries in place of the view when the receipt's deadline
 * passed before the view could be captured.
 */
export const BROWSER_TOOL_DEADLINE_NOTE =
	'(The view could not be read before the deadline; call read.)'

/**
 * Holds the status of a handled submission whose settle observed a change.
 */
export const BROWSER_TOOL_HANDLED_STATUS = 'the page handled the submission and changed'

/** Holds the status of a handled submission with no rendered change before the deadline. */
export const BROWSER_TOOL_UNCHANGED_STATUS =
	'the page handled the submission and has not changed yet; do not submit again; call read or wait for the text you expect'

/** Holds the refusal for a hold requested while an earlier input remains pending. */
export const BROWSER_TOOL_PENDING_NOTE = 'An earlier input is still pending; call read.'

/** Names the tools that observe the view without recording an action. */
export const BROWSER_OBSERVATION_TOOL_NAMES: readonly string[] = Object.freeze(['read'])

/**
 * Holds the note an action receipt carries in place of the view when the page changed under the
 * capture twice: once after the action, and again during the one retry that follows the page's
 * readiness.
 */
export const BROWSER_TOOL_CHANGED_NOTE =
	'(The page changed before the view could be read; call read.)'

/**
 * Holds the clause that ends a cut result without an addressed page window.
 */
export const BROWSER_TOOL_CUT_FOOTER = 'the rest was cut'

/**
 * Names the accessibility roles the `type` tool writes to: `textbox`, `searchbox`, and
 * `spinbutton` take typed text, and `combobox` and `listbox` take a select control's option
 * or, for a text input with suggestions, typed text.
 *
 * @remarks
 * The set names the roles the tool admits, not every element that accepts text: an element
 * with another explicit role can still accept text through its element contract. Chromium
 * 141.0.7390.37 reports a `contenteditable` region without an explicit role as `generic`, which
 * the outline gives no reference.
 */
export const BROWSER_TYPED_ROLES: ReadonlySet<string> = Object.freeze(
	new Set(['textbox', 'searchbox', 'spinbutton', 'combobox', 'listbox']),
)

/** Caps the `wait` tool's `timeout` parameter at `30_000` milliseconds. */
export const BROWSER_TOOL_TIMEOUT_LIMIT_MS = 30_000

/**
 * Names the eight page tools: `read`, `click`, `type`, `press`, `navigate`, `wait`, `dialog`,
 * and `switch`.
 */
export const BROWSER_TOOL_NAMES: readonly BrowserToolName[] = Object.freeze([
	'read',
	'click',
	'type',
	'press',
	'navigate',
	'wait',
	'dialog',
	'switch',
])

/**
 * Matches a page tool name the toolset can advertise: 1 to 64 ASCII letters, digits,
 * underscores, and hyphens.
 *
 * @remarks
 * The pattern is the narrowest of the tool-name rules of the providers the fleet targets. The
 * Anthropic Messages API tool definition requires a `name` matching `^[a-zA-Z0-9_-]{1,64}$`, and
 * the OpenAI function-calling definition requires a function `name` of letters, digits,
 * underscores, and dashes, at most 64 characters long. The WebMCP specification draft allows a
 * period and up to 128 code points (the guide's "Declared conformance gaps" section), so a page tool
 * named `a.b` or one longer than 64 characters is skipped with the reason `pattern`.
 */
export const BROWSER_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Names the URL schemes the `navigate` tool accepts by default: `http:` and `https:`. */
export const BROWSER_SCHEMES: readonly string[] = Object.freeze(['http:', 'https:'])

/**
 * Holds the advertised definition of each reserved tool: its description, its JSON Schema
 * parameters, and its annotations.
 *
 * @remarks
 * Every tool description is at most 25 words and says what the tool shows or does, and for
 * `read` when to call it; every parameter description is at most 100 characters.
 * `read` and `journeys` require `from` and accept optional `to` and `search`; an element's own
 * reading is `BrowserElementInterface.read`. `read` and `journeys` annotate `pure` and
 * `untrusted`, `wait` annotates `pure`, and the rest carry no annotation. `type` takes
 * `secret` beside `ref`, `text`, and `submit`. The journey tools `record`, `save`, `journeys`,
 * `edit`, `replay`, `forget`, and `capture` are advertised only by a toolset constructed with `journeys`.
 * `wait` takes `absent` beside `text` and `timeout`.
 */
export const BROWSER_TOOL_COPY: Readonly<Record<BrowserToolName, ToolDefinition>> = Object.freeze({
	read: Object.freeze({
		name: 'read',
		description:
			'Shows numbered lines of the page, with references like e4 to act on. Call it to learn a fact or to find an element.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				from: Object.freeze({
					type: 'integer',
					description: "The first line to show: 1 for the top, or the line a reply's footer names.",
				}),
				to: Object.freeze({
					type: 'integer',
					description: 'The last line to show. Default: as many lines as fit.',
				}),
				search: Object.freeze({
					type: 'string',
					description:
						'Words to find; the reply opens one line before the first match at or after from.',
				}),
			}),
			required: Object.freeze(['from']),
		}),
		annotations: Object.freeze({ pure: true, untrusted: true }),
	}),
	click: Object.freeze({
		name: 'click',
		description: 'Clicks the referenced element, settles its action, and returns the page.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				ref: Object.freeze({ type: 'string', description: 'The reference, such as e4.' }),
			}),
			required: Object.freeze(['ref']),
		}),
	}),
	type: Object.freeze({
		name: 'type',
		description:
			'Fills the referenced control, optionally submits its form, settles the action, and returns the page.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				ref: Object.freeze({ type: 'string', description: 'The reference, such as e4.' }),
				text: Object.freeze({
					type: 'string',
					description: 'The text to type or the option to choose.',
				}),
				submit: Object.freeze({
					type: 'boolean',
					description: 'True to submit its form after typing.',
				}),
				secret: Object.freeze({
					type: 'boolean',
					description: 'True to keep the text out of the receipt, such as a password.',
				}),
			}),
			required: Object.freeze(['ref', 'text']),
		}),
	}),
	press: Object.freeze({
		name: 'press',
		description: 'Presses a key or chord, settles its action, and returns the page.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				key: Object.freeze({ type: 'string', description: 'The key or chord, such as Enter.' }),
			}),
			required: Object.freeze(['key']),
		}),
	}),
	navigate: Object.freeze({
		name: 'navigate',
		description: 'Opens an absolute web address in the current tab and returns the loaded page.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				url: Object.freeze({ type: 'string', description: 'The absolute http or https address.' }),
			}),
			required: Object.freeze(['url']),
		}),
	}),
	wait: Object.freeze({
		name: 'wait',
		description: 'Waits for text to appear or leave, then returns the page.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				text: Object.freeze({ type: 'string', description: 'The text to wait for.' }),
				absent: Object.freeze({
					type: 'boolean',
					description: 'True to wait for the text to leave the page.',
				}),
				timeout: Object.freeze({
					type: 'integer',
					description: 'The most seconds to wait, at most 30. Default: 5.',
				}),
			}),
			required: Object.freeze(['text']),
		}),
		annotations: Object.freeze({ pure: true }),
	}),
	dialog: Object.freeze({
		name: 'dialog',
		description: 'Answers the open dialog, settles the interrupted action, and returns the page.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				accept: Object.freeze({
					type: 'boolean',
					description: 'True to accept the dialog; false to dismiss it.',
				}),
				text: Object.freeze({ type: 'string', description: 'The answer to a prompt dialog.' }),
			}),
			required: Object.freeze(['accept']),
		}),
	}),
	switch: Object.freeze({
		name: 'switch',
		description: 'Selects an open tab that read lists and returns its page.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				tab: Object.freeze({ type: 'string', description: 'The tab, such as t2.' }),
			}),
			required: Object.freeze(['tab']),
		}),
	}),
	record: Object.freeze({
		name: 'record',
		description:
			'Starts recording your next actions as a journey with that name; call save when it is done.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				journey: Object.freeze({
					type: 'string',
					description: 'The journey name: lowercase words joined by hyphens, such as add-kettle.',
				}),
			}),
			required: Object.freeze(['journey']),
		}),
	}),
	save: Object.freeze({
		name: 'save',
		description:
			'Stops recording and saves the journey; describe what it achieves in one sentence.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				description: Object.freeze({
					type: 'string',
					description: 'What the journey achieves, in one sentence.',
				}),
			}),
			required: Object.freeze(['description']),
		}),
	}),
	journeys: Object.freeze({
		name: 'journeys',
		description: 'Shows saved journeys as numbered lines.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				search: Object.freeze({
					type: 'string',
					description: 'Words to find in the given range.',
				}),
				from: Object.freeze({
					type: 'integer',
					description: 'The first line: 1 for the top.',
				}),
				to: Object.freeze({
					type: 'integer',
					description: 'The last line to show. Default: as many lines as fit.',
				}),
			}),
			required: Object.freeze(['from']),
		}),
		annotations: Object.freeze({ pure: true, untrusted: true }),
	}),
	edit: Object.freeze({
		name: 'edit',
		description:
			'Changes a saved journey: add, remove, or update steps by their ids from journeys, or declare a parameter.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				journey: Object.freeze({
					type: 'string',
					description: 'The journey name, such as add-kettle.',
				}),
				edits: Object.freeze({
					description:
						'The changes, as an array or its JSON string, applied in order; one invalid change refuses them all.',
					anyOf: Object.freeze([
						Object.freeze({
							type: 'array',
							items: Object.freeze({
								type: 'object',
								properties: Object.freeze({
									operation: Object.freeze({
										type: 'string',
										enum: Object.freeze(['add', 'remove', 'update', 'declare']),
										description: 'What the change does.',
									}),
									id: Object.freeze({
										type: 'string',
										description: 'The step to remove or update, such as s3.',
									}),
									step: Object.freeze({
										type: 'object',
										description: 'The step to add: its action, its arguments, and ref or tab.',
									}),
									before: Object.freeze({
										type: 'string',
										description: 'The step to add it before, such as s3.',
									}),
									after: Object.freeze({
										type: 'string',
										description: 'The step to add it after, such as s3.',
									}),
									ref: Object.freeze({
										type: 'string',
										description: 'The element the added or updated step acts on, such as e4.',
									}),
									arguments: Object.freeze({
										type: 'object',
										description: 'The arguments to change, merged by key.',
									}),
									name: Object.freeze({
										type: 'string',
										description: 'The parameter to declare, such as email.',
									}),
									parameter: Object.freeze({
										type: 'object',
										description: 'The parameter: its default, or secret set to true.',
									}),
								}),
								required: Object.freeze(['operation']),
							}),
						}),
						Object.freeze({ type: 'string' }),
					]),
				}),
			}),
			required: Object.freeze(['journey', 'edits']),
		}),
	}),
	replay: Object.freeze({
		name: 'replay',
		description: "Replays a saved journey step by step; give each parameter's value under inputs.",
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				journey: Object.freeze({
					type: 'string',
					description: 'The journey name, such as add-kettle.',
				}),
				inputs: Object.freeze({
					type: 'object',
					description: "Each parameter's value by its name.",
					additionalProperties: Object.freeze({ type: 'string' }),
				}),
			}),
			required: Object.freeze(['journey']),
		}),
	}),
	capture: Object.freeze({
		name: 'capture',
		description: 'Saves the current view as a PNG in the runs directory and returns its path.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				full: Object.freeze({
					type: 'boolean',
					description: 'True captures the full page; false captures the viewport.',
				}),
			}),
			required: Object.freeze(['full']),
		}),
	}),
	forget: Object.freeze({
		name: 'forget',
		description: 'Removes a saved journey and all its runs; the name is free to record again.',
		parameters: Object.freeze({
			type: 'object',
			properties: Object.freeze({
				journey: Object.freeze({
					type: 'string',
					description: 'The journey name, such as add-kettle.',
				}),
			}),
			required: Object.freeze(['journey']),
		}),
	}),
})

// === Browser journeys

/**
 * Matches a journey name: lowercase letters and digits in words joined by single hyphens, at most
 * 64 characters, and never a Windows reserved device name.
 *
 * @remarks
 * A journey's name is its directory under the store's root, so the pattern refuses `con`, `prn`,
 * `aux`, `nul`, `com1` to `com9`, and `lpt1` to `lpt9`, which a Windows host refuses as a path
 * segment.
 */
export const BROWSER_JOURNEY_NAME_PATTERN =
	/^(?=.{1,64}$)(?!(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$)[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Matches a journey parameter name: a lowercase letter followed by letters and digits. */
export const BROWSER_JOURNEY_PARAMETER_PATTERN = /^[a-z][a-zA-Z0-9]*$/

/** Matches a run id containing an ISO timestamp with hyphenated time and a hexadecimal suffix. */
export const BROWSER_RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-[a-f0-9]{4}$/

/** Holds the journey and run file format this package writes and reads, `1`. */
export const BROWSER_JOURNEY_FORMAT_VERSION: BrowserJourney['format'] = 1

/**
 * Names the native actions a journey step can hold: `click`, `type`, `press`, `navigate`, `wait`,
 * `dialog`, and `switch`.
 *
 * @remarks
 * A step's action is one of these, an adopted page tool's name, or `unresolved`.
 */
export const BROWSER_JOURNEY_ACTIONS: readonly BrowserToolName[] = Object.freeze([
	'click',
	'type',
	'press',
	'navigate',
	'wait',
	'dialog',
	'switch',
])

/**
 * Lists every outcome a `BrowserAction` and a run step carry: `done`, `refused`, `timeout`, and
 * `interrupted`.
 */
export const BROWSER_ACTION_OUTCOMES: readonly BrowserStepOutcome[] = Object.freeze([
	'done',
	'refused',
	'timeout',
	'interrupted',
])

/**
 * Lists every navigation stage a `BrowserAction` and a run step carry: `requested`, `committed`,
 * and `loaded`.
 */
export const BROWSER_ACTION_STAGES: readonly BrowserNavigationStage[] = Object.freeze([
	'requested',
	'committed',
	'loaded',
])

/** Holds the result the `journeys` tool returns when no journey is saved. */
export const BROWSER_JOURNEY_EMPTY_LISTING = 'No journeys are saved; call record to start one.'

/**
 * Names the journey tools a toolset constructed with `journeys` registers and reserves: `record`,
 * `save`, `journeys`, `edit`, `replay`, `forget`, and `capture`.
 */
export const BROWSER_JOURNEY_TOOL_NAMES: readonly BrowserToolName[] = Object.freeze([
	'record',
	'save',
	'journeys',
	'edit',
	'replay',
	'forget',
	'capture',
])

/** Names observation and journey tools that cannot become journey steps. */
export const BROWSER_JOURNEY_NON_STEP_TOOLS: readonly string[] = Object.freeze([
	...BROWSER_OBSERVATION_TOOL_NAMES,
	...BROWSER_JOURNEY_TOOL_NAMES,
])

/** Names native tool arguments represented by journey targets, tabs, or secret bindings. */
export const BROWSER_JOURNEY_STEP_KEYS: readonly string[] = Object.freeze(['ref', 'tab', 'secret'])

/** Holds the refusal `record`, `save`, `edit`, and `forget` return when the journeys are read-only. */
export const BROWSER_JOURNEY_READONLY_REFUSAL = 'The journeys are read-only; call replay.'

/** Holds the refusal `record` returns while another journey is recording. */
export const BROWSER_JOURNEY_RECORDING_REFUSAL = 'A journey is recording; call save first.'

/** Holds the refusal `save` returns when no journey is recording. */
export const BROWSER_JOURNEY_IDLE_REFUSAL =
	'No journey is recording, so nothing can be saved; answer the user. A journey holds only the actions after record, so call record before them.'

/** Caps a default reading window at 100 addressed lines. */
export const BROWSER_READ_LINES = 100

/** Caps the displayed search hit list at 50 line numbers. */
export const BROWSER_READ_MATCHES = 50

/** Opens a search window one line before its first match. */
export const BROWSER_READ_CONTEXT = 1

/** Wraps projection rows at 800 UTF-16 units, leaving room for receipt metadata. */
export const BROWSER_READ_WIDTH = 800

/** Reports changed line numbers without restarting a continuation. */
export const BROWSER_READ_CHANGED_NOTE =
	'The page changed since the last view; line numbers might differ.'
