import { decodeBase64, encodeBase64 } from '@orkestrel/codec'
import type {
	BrowserJourneyInput,
	BrowserPageInterface,
	CDPClientInterface,
	BrowserJourneyWriteOptions,
	BrowserLine,
	BrowserLineSpan,
	BrowserPassage,
	BrowserSearch,
	BrowserJourney,
	BrowserStoreFault,
	BrowserJourneyEdit,
	BrowserJourneyParameter,
	BrowserJourneyStep,
	BrowserJourneyStepInput,
	BrowserRun,
	BrowserElementQuery,
	BrowserOutline,
	BrowserOutlineNode,
	BrowserChord,
	BrowserCookie,
	BrowserCookieInput,
	BrowserIsolateOptions,
	BrowserCoverageRange,
	BrowserDocument,
	BrowserEmulationOptions,
	BrowserFrameInfo,
	BrowserFunctionCoverage,
	BrowserHAR,
	BrowserHAREntry,
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
	BrowserResponse,
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
	BrowserElementReason,
	BrowserElementSubject,
} from './types.js'
import type { ToolDefinition } from '@orkestrel/tool'
import {
	attempt,
	isArray,
	isBoolean,
	isFiniteNumber,
	isFunction,
	isInteger,
	isJSONValue,
	isRecord,
	isString,
	parseArray,
	parseEnum,
} from '@orkestrel/contract'
import {
	BROWSER_TOOL_COPY,
	BROWSER_READ_WIDTH,
	BROWSER_TOOL_CUT_FOOTER,
	BROWSER_READ_LINES,
	BROWSER_READ_MATCHES,
	BROWSER_READ_CONTEXT,
	BROWSER_READ_CHANGED_NOTE,
	BROWSER_ACTION_OUTCOMES,
	BROWSER_ACTION_STAGES,
	BROWSER_NAVIGATION_REASONS,
	BROWSER_JOURNEY_ACTIONS,
	BROWSER_JOURNEY_NON_STEP_TOOLS,
	BROWSER_JOURNEY_STEP_KEYS,
	BROWSER_RUN_ID_PATTERN,
	BROWSER_JOURNEY_FORMAT_VERSION,
	BROWSER_JOURNEY_NAME_PATTERN,
	BROWSER_JOURNEY_PARAMETER_PATTERN,
	BROWSER_OUTLINE_OMITTED_ROLES,
	BROWSER_SEARCH_PATTERN,
	BROWSER_RESULT_LIMIT,
	BROWSER_REGISTRY_OUTPUT_LIMIT,
	BROWSER_RESULT_LIMIT_PATTERN,
	BROWSER_SNAPSHOT_NODE_LIMIT,
	BROWSER_KEY_MODIFIERS,
	BROWSER_MOUSE_BUTTON_MASKS,
} from './constants.js'
import {
	isBrowserJourneyBinding,
	isBrowserJourneyValidationContext,
	isBrowserJourneyTarget,
	isBrowserJourneyTab,
	isBrowserSecretBinding,
} from './validators.js'
import { BrowserError, isBrowserError } from './errors.js'
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
 * Describes an element refusal, adding a fresh-reference instruction for `GONE`.
 *
 * @param subject - Element reference or named subject
 * @param reason - Reason the operation was refused
 * @param detail - Specific explanation replacing the default reason text
 * @returns The refusal message with its final punctuation
 *
 * @example
 * ```ts
 * describeBrowserRefusal('e4', 'GONE')
 * // 'Element [ref=e4] is gone because the page changed; call read for fresh refs.'
 * ```
 */
export function describeBrowserRefusal(
	subject: string | BrowserElementSubject,
	reason: BrowserElementReason,
	detail?: string,
): string {
	const name = isString(subject) ? `Element [ref=${subject}]` : subject.subject
	const text =
		detail ??
		(reason === 'GONE'
			? 'is gone because the page changed'
			: reason === 'UNTRUSTED'
				? 'needs a trusted event'
				: reason.toLowerCase())
	return `${name} ${text}${reason === 'GONE' ? '; call read for fresh refs.' : '.'}`
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
 * Renders one outline row: the node's role, quoted accessible name, reference, and states.
 *
 * @remarks
 * The reference renders as `[ref=eN]` after the name, or after the role when the name is empty.
 * After the reference the row appends `value="V"` when the node carries a non-empty value,
 * `pressed=true|false|mixed`, `expanded=true|false`, and `selected=true|false` when present,
 * `[checked]` when checked, `[disabled]` when disabled, and `[tool=NAME]` for a page tool's form,
 * in that order. A node without a reference renders without one.
 *
 * @param node - The outline node
 * @returns The rendered row
 *
 * @example
 * ```ts
 * import { renderBrowserOutlineRow } from '@orkestrel/browser'
 *
 * renderBrowserOutlineRow({
 * 	id: '4',
 * 	parent: undefined,
 * 	children: [],
 * 	backend: undefined,
 * 	frame: undefined,
 * 	ignored: false,
 * 	role: 'checkbox',
 * 	name: ' Gift  wrap ',
 * 	description: undefined,
 * 	value: undefined,
 * 	properties: { checked: 'true' },
 * 	session: 'main',
 * 	reference: 'e4',
 * }) // 'checkbox "Gift wrap" [ref=e4] [checked]'
 * ```
 */
export function renderBrowserOutlineRow(node: BrowserOutlineNode): string {
	const name = normalizeBrowserName(node.name ?? '')
	const role = node.role ?? 'unknown'
	let row = `${role}${name === '' ? '' : ` ${JSON.stringify(name)}`}${node.reference === undefined ? '' : ` [ref=${node.reference}]`}`
	if (node.value !== undefined && node.value !== '')
		row += ` value=${JSON.stringify(String(node.value))}`
	for (const key of ['pressed', 'expanded', 'selected']) {
		const value = node.properties[key]
		if (isString(value) || isBoolean(value)) row += ` ${key}=${String(value)}`
	}
	if (node.properties['checked'] === true || node.properties['checked'] === 'true')
		row += ' [checked]'
	if (node.properties['disabled'] === true) row += ' [disabled]'
	if (node.tool !== undefined) row += ` [tool=${node.tool}]`
	return row
}

/**
 * Collects distinct lowercase words of at least 3 letters or digits.
 *
 * @param text - Text to scan
 * @returns The searchable whole words
 *
 * @example
 * ```ts
 * import { collectBrowserWords } from '@orkestrel/browser'
 * [...collectBrowserWords('The cart, the bag')] // ['the', 'cart', 'bag']
 * ```
 */
export function collectBrowserWords(text: string): ReadonlySet<string> {
	return new Set(
		Array.from(text.toLowerCase().matchAll(BROWSER_SEARCH_PATTERN), (match) => match[0]),
	)
}

/** Renders document-order accessibility lines with a bounded element count.
 * @param url - Document address
 * @param title - Document title
 * @param nodes - Ordered accessibility nodes from one capture
 * @param limit - Maximum referenced elements
 * @param secrets - Registered text to redact before wrapping
 * @returns Wrapped lines, element counts, and the focused element
 * @example
 * ```ts
 * const outline = renderBrowserOutline('https://shop.example/', 'Shop', [], 150)
 * outline.lines // []
 * ```
 */
export function renderBrowserOutline(
	url: string,
	title: string,
	source: readonly BrowserOutlineNode[],
	limit: number,
	secrets: readonly string[] = [],
): BrowserOutline {
	const nodes = source.map((node) => ({
		...node,
		name: node.name === undefined ? undefined : redactBrowserText(node.name, secrets),
		value: node.value === undefined ? undefined : redactBrowserText(String(node.value), secrets),
	}))
	const indexed = new Map<string, BrowserOutlineNode>()
	for (const node of nodes)
		if (!indexed.has(`${node.session}:${node.id}`)) indexed.set(`${node.session}:${node.id}`, node)
	const omitted = new Set<BrowserOutlineNode>()
	const rows: BrowserLine[] = []
	let count = 0
	let total = 0
	let focus: string | undefined
	for (const [position, node] of nodes.entries()) {
		if (node.ignored) continue
		if (node.reference !== undefined) {
			total += 1
			if (node.properties['focused'] === true) focus = renderBrowserOutlineRow(node)
		}
		if (omitted.has(node)) continue
		const name = normalizeBrowserName(node.name ?? '')
		const parent = indexed.get(`${node.session}:${node.parent}`)
		let spans: readonly BrowserLineSpan[] = []
		if (node.role === 'heading') {
			const children = nodes.filter((candidate) => belongsBrowserOutline(candidate, node, indexed))
			const references = children.filter((child) => child.reference !== undefined && !child.ignored)
			const folded = references.length === 1 ? references[0] : undefined
			const level = node.properties['level']
			spans = [
				{
					category: 'syntax',
					text: `${'#'.repeat(isInteger(level) && level > 0 ? Math.min(level, 6) : 1)} `,
				},
			]
			if (
				folded !== undefined &&
				normalizeBrowserName(folded.name ?? '') === name &&
				count < limit
			) {
				spans = [...spans, ...renderBrowserSpans(folded, url)]
				count += 1
				for (const child of children) omitted.add(child)
			} else {
				spans = [...spans, { category: 'text', text: name }]
				for (const child of children) if (child.role === 'StaticText') omitted.add(child)
			}
		} else if (node.role === 'row' || node.role === 'LayoutTableRow') {
			const children = nodes.filter((candidate) => belongsBrowserOutline(candidate, node, indexed))
			const cells = children.filter((child) =>
				['cell', 'gridcell', 'columnheader', 'rowheader', 'LayoutTableCell'].includes(
					child.role ?? '',
				),
			)
			const joined: BrowserLineSpan[] = []
			for (const cell of cells) {
				if (joined.length > 0) joined.push({ category: 'syntax', text: ' | ' })
				const controls = children.filter(
					(child) => child.reference !== undefined && belongsBrowserOutline(child, cell, indexed),
				)
				if (controls.length === 0)
					joined.push({ category: 'text', text: normalizeBrowserName(cell.name ?? '') })
				else {
					const contents = children.filter(
						(child) =>
							belongsBrowserOutline(child, cell, indexed) &&
							(child.reference !== undefined || child.role === 'StaticText'),
					)
					for (const control of contents) {
						if (controls.some((owner) => belongsBrowserOutline(control, owner, indexed))) continue
						if (control.reference === undefined) {
							joined.push(
								{ category: 'text', text: normalizeBrowserName(control.name ?? '') },
								{ category: 'syntax', text: ' ' },
							)
							continue
						}
						if (count >= limit) continue
						joined.push(...renderBrowserSpans(control, url))
						joined.push({ category: 'syntax', text: ' ' })
						count += 1
					}
					if (joined.at(-1)?.text === ' ') joined.pop()
				}
			}
			spans = joined
			for (const child of children) omitted.add(child)
		} else if (node.role === 'image' || node.role === 'img') {
			if (name !== '')
				spans = [
					{ category: 'syntax', text: 'image "' },
					{ category: 'text', text: JSON.stringify(name).slice(1, -1) },
					{ category: 'syntax', text: '"' },
				]
		} else if (node.role === 'StaticText') {
			let owner = parent
			const visited = new Set<string>()
			while (owner !== undefined && owner.reference === undefined && !visited.has(owner.id)) {
				visited.add(owner.id)
				owner = indexed.get(`${owner.session}:${owner.parent}`)
			}
			if (
				name !== '' &&
				!(owner !== undefined && normalizeBrowserName(owner.name ?? '') !== '') &&
				name !== normalizeBrowserName(parent?.name ?? '') &&
				name !== normalizeBrowserName(String(owner?.value ?? ''))
			) {
				let text = node.name ?? ''
				for (let index = position + 1; index < nodes.length; index += 1) {
					if (parent === undefined) break
					const next = nodes[index]
					if (next?.role === 'InlineTextBox') continue
					if (
						next?.role !== 'StaticText' ||
						next.parent !== node.parent ||
						next.session !== node.session
					)
						break
					text += next.name ?? ''
					omitted.add(next)
				}
				spans = [{ category: 'text', text: normalizeBrowserName(redactBrowserText(text, secrets)) }]
			}
		} else if (node.reference !== undefined && count < limit) {
			spans = renderBrowserSpans(node, url)
			count += 1
		}
		if (spans.length === 0) continue
		const list = nodes.find(
			(candidate) =>
				candidate.role === 'listitem' && belongsBrowserOutline(node, candidate, indexed),
		)
		if (list !== undefined && !omitted.has(list) && node.role !== 'heading') {
			spans = [{ category: 'syntax', text: '- ' }, ...spans]
			omitted.add(list)
		}
		rows.push(
			...wrapBrowserLine({
				spans: spans.map((span) => ({ ...span, text: redactBrowserText(span.text, secrets) })),
			}),
		)
	}
	return {
		url: redactBrowserText(url, secrets),
		title: redactBrowserText(title, secrets),
		lines: rows,
		listed: count,
		found: total,
		focus: focus === undefined ? undefined : redactBrowserText(focus, secrets),
	}
}

/** Checks whether a node descends from another within one session's captured tree.
 * @param node - Candidate descendant
 * @param ancestor - Owning node
 * @param indexed - Nodes indexed by session and accessibility identity
 * @returns True if the node descends from the ancestor; false otherwise
 */
export function belongsBrowserOutline(
	node: BrowserOutlineNode,
	ancestor: BrowserOutlineNode,
	indexed: ReadonlyMap<string, BrowserOutlineNode>,
): boolean {
	const seen = new Set<string>()
	let parent = node.parent
	while (parent !== undefined && !seen.has(parent)) {
		if (node.session === ancestor.session && parent === ancestor.id) return true
		seen.add(parent)
		parent = indexed.get(`${node.session}:${parent}`)?.parent
	}
	return false
}

/** Renders an element as searchable text separated from references and syntax.
 * @param node - Captured element
 * @param url - Owning document address
 * @returns Ordered row spans
 */
export function renderBrowserSpans(
	node: BrowserOutlineNode,
	url: string,
): readonly BrowserLineSpan[] {
	const spans: BrowserLineSpan[] = []
	spans.push({ category: 'syntax', text: node.role ?? 'unknown' })
	const name = normalizeBrowserName(node.name ?? '')
	if (name !== '')
		spans.push(
			{ category: 'syntax', text: ' "' },
			{ category: 'text', text: JSON.stringify(name).slice(1, -1) },
			{ category: 'syntax', text: '"' },
		)
	if (node.reference !== undefined)
		spans.push(
			{ category: 'syntax', text: ' ' },
			{ category: 'reference', text: `[ref=${node.reference}]` },
		)
	const href = node.properties['url']
	if (node.role === 'link' && isString(href)) {
		const address = new URL(href, url)
		spans.push(
			{ category: 'syntax', text: ' ' },
			{
				category: 'text',
				text:
					address.origin === new URL(url).origin
						? `${address.pathname}${address.search}${address.hash}`
						: address.href,
			},
		)
	}
	if (node.value !== undefined && node.value !== '') {
		spans.push(
			{ category: 'syntax', text: ' value="' },
			{
				category: 'text',
				text: JSON.stringify(normalizeBrowserName(String(node.value))).slice(1, -1),
			},
			{ category: 'syntax', text: '"' },
		)
	}
	for (const key of ['pressed', 'expanded', 'selected']) {
		const value = node.properties[key]
		if (isString(value) || isBoolean(value))
			spans.push(
				{ category: 'syntax', text: ` ${key}=` },
				{ category: 'syntax', text: String(value) },
			)
	}
	if (node.properties['checked'] === true || node.properties['checked'] === 'true')
		spans.push({ category: 'syntax', text: ' [checked]' })
	if (node.properties['disabled'] === true) spans.push({ category: 'syntax', text: ' [disabled]' })
	if (node.tool !== undefined)
		spans.push(
			{ category: 'syntax', text: ' [tool=' },
			{ category: 'text', text: node.tool },
			{ category: 'syntax', text: ']' },
		)
	return spans
}

/** Joins a projected line's spans without adding an address.
 * @param line - Projected line
 * @returns Rendered content
 */
export function renderBrowserLine(line: BrowserLine): string {
	return line.spans.map((span) => span.text).join('')
}

/** Finds the first line contributing a whitespace-normalized match across consecutive text spans.
 * @param lines - Wrapped projection
 * @param text - Visible text to locate
 * @returns One-based opening line, or 1 when no match exists
 */
export function findBrowserText(lines: readonly BrowserLine[], text: string): number {
	const ends: number[] = []
	let joined = ''
	for (const line of lines) {
		if (joined !== '' && line.spans[0]?.text !== '↳') joined += ' '
		joined += normalizeBrowserName(
			line.spans
				.filter((span) => span.category === 'text')
				.map((span) =>
					span.text.replace(/\\(?:["\\/bfnrt]|u[\da-fA-F]{4})/g, (escape) =>
						String(JSON.parse('"' + escape + '"')),
					),
				)
				.join(' '),
		)
		ends.push(joined.length)
	}
	const match = joined.indexOf(normalizeBrowserName(text))
	return match < 0 ? 1 : Math.max(1, ends.findIndex((end) => end > match) + 1)
}

/** Wraps spans before numbering, marking hard continuations with a leading ↳.
 * @remarks A soft wrap breaks before the end of a name rather than before its reference span.
 * @param line - Unwrapped semantic row
 * @returns Lines no wider than the projection width, preserving code points and reference tokens
 */
export function wrapBrowserLine(line: BrowserLine): readonly BrowserLine[] {
	const text = renderBrowserLine(line)
	const lines: BrowserLine[] = []
	const references: Array<readonly [number, number]> = []
	let boundary = 0
	for (const span of line.spans) {
		if (span.category === 'reference') references.push([boundary, boundary + span.text.length])
		boundary += span.text.length
	}
	let offset = 0
	let continuation = false
	while (offset < text.length) {
		const room = BROWSER_READ_WIDTH - (continuation ? 1 : 0)
		let end = Math.min(text.length, offset + room)
		let hard = false
		if (end < text.length) {
			let whitespace = text.slice(offset, end + 1).search(/\s+\S*$/u)
			while (
				whitespace > 0 &&
				references.some(
					([start]) =>
						start > offset + whitespace && /^\s+$/u.test(text.slice(offset + whitespace, start)),
				)
			)
				whitespace = text.slice(offset, offset + whitespace).search(/\s+\S*$/u)
			if (whitespace > 0) end = offset + whitespace
			else {
				hard = true
				for (const [start, last] of references)
					if (end >= start - 1 && end < last) end = Math.max(offset + 1, start - 2)
				if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end -= 1
			}
		}
		const spans: BrowserLineSpan[] = continuation ? [{ category: 'syntax', text: '↳' }] : []
		let position = 0
		for (const span of line.spans) {
			const last = position + span.text.length
			if (last > offset && position < end)
				spans.push({
					category: span.category,
					text: span.text.slice(Math.max(0, offset - position), end - position),
				})
			position = last
		}
		lines.push({ spans })
		offset = end
		if (!hard) while (offset < text.length && /\s/u.test(text.charAt(offset))) offset += 1
		continuation = hard
	}
	return lines
}

/** Finds the highest-scoring text lines within an inclusive range using whole words and prefixes.
 * @param lines - Complete wrapped projection
 * @param search - Words to find
 * @param from - First candidate line. Default: 1
 * @param to - Last candidate line. Default: the end
 * @returns One-based best-scoring line numbers
 */
export function scanBrowserLines(
	lines: readonly BrowserLine[],
	search: string,
	from = 1,
	to = lines.length,
): readonly number[] {
	const words = collectBrowserWords(search)
	const matches: number[] = []
	let best = 0
	for (let index = from - 1; index < Math.min(to, lines.length); index += 1) {
		const line = lines[index]
		if (line === undefined) continue
		const own = [
			...collectBrowserWords(
				line.spans
					.filter((span) => span.category === 'text')
					.map((span) => span.text)
					.join(' '),
			),
		]
		let score = 0
		for (const word of words)
			if (
				own.some(
					(candidate) =>
						word === candidate ||
						(Math.min(word.length, candidate.length) >= 4 &&
							(word.startsWith(candidate) || candidate.startsWith(word))),
				)
			)
				score += 1
		if (score === 0 || score < best) continue
		if (score > best) matches.length = 0
		best = score
		matches.push(index + 1)
	}
	return matches
}

/** Refuses invalid line coordinates before selecting content.
 * @param from - Inclusive first line
 * @param to - Optional inclusive last line
 * @param total - Available lines, when captured
 * @returns Nothing
 */
export function validateBrowserLines(from: number, to?: number, total?: number): void {
	if (
		!Number.isSafeInteger(from) ||
		from < 1 ||
		(to !== undefined && (!Number.isSafeInteger(to) || to < 1))
	)
		throw new BrowserError(
			'ARGUMENT',
			'The from and to parameters must be positive safe integers.',
			{ subject: 'toolset' },
		)
	if (to !== undefined && to < from)
		throw new BrowserError('ARGUMENT', 'The to parameter must not precede from.', {
			subject: 'toolset',
		})
	if (total !== undefined && total > 0 && from > total)
		throw new BrowserError(
			'ARGUMENT',
			`Line ${from} is past the end; the page has ${total} lines.`,
			{ subject: 'toolset' },
		)
}

/** Abbreviates displayed metadata without splitting a Unicode code point.
 * @param text - Metadata text
 * @param limit - Available UTF-16 units
 * @returns Normalized text with an ellipsis when abbreviated
 */
export function abbreviateBrowserText(text: string, limit: number): string {
	const normalized = normalizeBrowserName(text)
	if (normalized.length <= limit) return normalized
	let end = Math.max(0, limit - 1)
	if (normalized.charCodeAt(end - 1) >= 0xd800 && normalized.charCodeAt(end - 1) <= 0xdbff) end -= 1
	return `${normalized.slice(0, end)}…`
}

/** Renders an exact addressed-range footer, including the next line when content remains.
 * @param from - First returned line
 * @param to - Last returned line
 * @param total - Total projected lines
 * @param tool - Tool that serves the continuation. Default: read
 * @returns Complete footer
 */
export function renderBrowserFooter(
	from: number,
	to: number,
	total: number,
	tool = 'read',
): string {
	const subject = tool === 'journeys' ? 'listing' : 'page'
	if (total === 0) return `[empty ${subject}; the whole ${subject}]`
	const above = from - 1
	const below = total - to
	const counts = [
		above > 0 ? `${above} above` : undefined,
		below > 0 ? `${below} below` : undefined,
	].filter((value) => value !== undefined)
	return `[lines ${from}–${to} of ${total}; ${counts.length > 0 ? `${counts.join(', ')}; ` : ''}${below > 0 ? `call ${tool} with from ${to + 1} for more` : above > 0 ? `end of ${subject}` : `the whole ${subject}`}]`
}

/** Renders a shared search header and chooses its context line within the requested range.
 * @remarks A miss names `to` when it ends before the last line; an unbounded miss keeps its usual wording.
 * @param lines - Wrapped projection
 * @param from - Inclusive first candidate line
 * @param to - Inclusive last candidate line
 * @param search - Optional words to find
 * @returns Opening line and optional match or miss text
 */
export function renderBrowserSearch(
	lines: readonly BrowserLine[],
	from: number,
	to?: number,
	search?: string,
): BrowserSearch {
	if (search === undefined || search === '') return { from }
	const matches = scanBrowserLines(lines, search, from, to)
	const first = matches[0]
	const query = JSON.stringify(abbreviateBrowserText(search, 120))
	return first === undefined
		? {
				from,
				text:
					to !== undefined && to < lines.length
						? `No line from ${from} to ${to} matches ${query}.`
						: from === 1
							? `No line matches ${query}.`
							: `No line from ${from} on matches ${query}.`,
			}
		: {
				from: Math.max(from, first - BROWSER_READ_CONTEXT),
				text: `${matches.length} ${matches.length === 1 ? 'line matches' : 'lines match'} ${query}: ${matches.slice(0, BROWSER_READ_MATCHES).join(', ')}${matches.length > BROWSER_READ_MATCHES ? `, … and ${matches.length - BROWSER_READ_MATCHES} more; add words to narrow` : ''}`,
			}
}

/** Renders a bounded window with numbered rows and an exact continuation.
 * @remarks A partial-view line follows the page header when rows remain after the window.
 * A changed projection carries its change note even from line 1. A search missing its range
 * reports the first page-wide best match without moving the window. Its query is abbreviated
 * to 120 UTF-16 units. The miss sentence is reserved with the minimum window; when the whole
 * quoted row cannot also fit, only the sentence is shown, ending with a period.
 * @param passage - Projection and contextual metadata
 * @param limit - Whole-result character room
 * @returns A complete window
 * @throws Thrown when the range is invalid or room cannot hold metadata and a complete row
 */
export function renderBrowserPassage(passage: BrowserPassage, limit: number): string {
	const total = passage.lines.length
	validateBrowserLines(passage.from, passage.to, total)
	const header = [
		`page ${JSON.stringify(abbreviateBrowserText(passage.title, 120))} ${abbreviateBrowserText(passage.url, 160)} (${total} lines)`,
	]
	if (passage.tabs.length > 1) {
		const tabs: string[] = []
		for (const tab of passage.tabs) {
			const entry = `${tab.id} ${JSON.stringify(abbreviateBrowserText(tab.title, 60))}${tab.current ? ' (current)' : ''}`
			if (tabs.join(', ').length + entry.length > Math.min(400, Math.floor(limit / 8))) break
			tabs.push(entry)
		}
		const left = passage.tabs.length - tabs.length
		header.push(
			`tabs: ${tabs.join(', ')}${left > 0 ? `${tabs.length > 0 ? '; ' : ''}${left} more tabs omitted` : ''}`,
		)
	}
	if (passage.note !== undefined && passage.note !== '')
		header.push(abbreviateBrowserText(passage.note, 200))
	if (passage.changed) header.push(BROWSER_READ_CHANGED_NOTE)
	const found = renderBrowserSearch(passage.lines, passage.from, passage.to, passage.search)
	let search = found.text
	if (
		passage.search !== undefined &&
		passage.search !== '' &&
		scanBrowserLines(passage.lines, passage.search, passage.from, passage.to).length === 0
	) {
		const match = scanBrowserLines(passage.lines, passage.search)[0]
		const line = match === undefined ? undefined : passage.lines[match - 1]
		if (line !== undefined) {
			const range =
				passage.to !== undefined && passage.to < total
					? `from ${passage.from} to ${passage.to}`
					: `from ${passage.from} on`
			const sentence = `No line ${range} matches ${JSON.stringify(abbreviateBrowserText(passage.search, 120))}; the best match is line ${match}`
			search = `${sentence}.`
			const minimum = renderBrowserWindow(
				passage.lines,
				found.from,
				found.from,
				[...header, search].join('\n'),
				limit,
				'read',
				true,
			)
			const quote = `${sentence}:\n${match}: ${renderBrowserLine(line)}`
			if (minimum.length + quote.length - search.length <= limit) search = quote
		}
	}
	if (search !== undefined) header.push(search)
	return renderBrowserWindow(
		passage.lines,
		found.from,
		passage.to,
		header.join('\n'),
		limit,
		'read',
		true,
	)
}

/** Fits an unnumbered receipt and a complete page window inside one result limit.
 * @param passage - Redacted projection and metadata, with the opening line already selected
 * @param receipt - Redacted unnumbered status
 * @param limit - Whole-result character room
 * @returns Receipt followed by complete addressed rows and their exact footer
 */
export function renderBrowserReceiptWindow(
	passage: BrowserPassage,
	receipt: string,
	limit: number,
): string {
	const minimum = renderBrowserPassage({ ...passage, to: passage.from }, limit)
	const room = limit - minimum.length - 2
	if (room < 1)
		throw new BrowserError(
			'TOOLSET_LIMIT',
			'The result limit cannot hold the receipt and page window.',
		)
	const prefix = boundBrowserText(receipt, room, BROWSER_TOOL_CUT_FOOTER)
	return prefix + '\n\n' + renderBrowserPassage(passage, limit - prefix.length - 2)
}

/** Selects whole addressed rows after reserving the header and exact footer.
 * @remarks The partial switch reserves a partial-view line before selecting rows, independently of header text.
 * @param lines - Complete projection
 * @param from - Inclusive first line
 * @param to - Inclusive last line, or the default window
 * @param header - Bounded preceding text
 * @param limit - Whole-result room
 * @param tool - Continuation tool. Default: read
 * @param partial - Whether to show a partial-view line after the first header line. Default: false
 * @returns A complete bounded result
 */
export function renderBrowserWindow(
	lines: readonly BrowserLine[],
	from: number,
	to: number | undefined,
	header: string,
	limit: number,
	tool = 'read',
	partial = false,
): string {
	validateBrowserLines(from, to, lines.length)
	let body = header
	const rows: string[] = []
	let end = from - 1
	const last = Math.min(to ?? lines.length, from + BROWSER_READ_LINES - 1, lines.length)
	for (let index = from; index <= last; index += 1) {
		const line = lines[index - 1]
		if (line === undefined) break
		const row = `${index}: ${renderBrowserLine(line)}`
		const footer = renderBrowserFooter(from, index, lines.length, tool)
		const heading = header === '' ? [] : header.split(/\r\n|\n/)
		if (partial && index < lines.length)
			heading.splice(
				1,
				0,
				`This read shows lines ${from}–${index} of ${lines.length}; ${index + 1 === lines.length ? `line ${lines.length} is` : `lines ${index + 1}–${lines.length} are`} not shown yet.`,
			)
		const candidate = [...heading, ...rows, row].join('\n')
		if (candidate.length + footer.length + 1 > limit) break
		rows.push(row)
		body = candidate
		end = index
	}
	const footer = renderBrowserFooter(from, end, lines.length, tool)
	if ((lines.length > 0 && end < from) || body.length + footer.length + 1 > limit)
		throw new BrowserError(
			'TOOLSET_LIMIT',
			'The result limit cannot hold the header, footer, and next complete line.',
		)
	return `${body}\n${footer}`
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
		if (parts.some((part) => part === '')) throw new BrowserError('ARGUMENT', 'Empty key')
		return normalized.join('+')
	} catch {
		throw new BrowserError(
			'ARGUMENT',
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
 * Derives the advertised input schema from an authored one, adding a required `purpose` parameter when the schema requires nothing.
 * @param schema - Authored input schema, or undefined for a parameterless tool
 * @returns An advertised schema, or undefined when the authored `purpose` parameter is optional
 * @remarks The caller strips only a synthetic `purpose` parameter before invoking the page tool.
 */
export function deriveBrowserToolSchema(
	schema: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
	const properties = isRecord(schema?.['properties']) ? schema['properties'] : {}
	const required = isArray(schema?.['required']) ? schema['required'].filter(isString) : []
	if (Object.hasOwn(properties, 'purpose') && !required.includes('purpose')) return undefined
	if (required.length > 0) return schema
	return {
		...schema,
		type: 'object',
		properties: {
			...properties,
			purpose: { type: 'string', description: 'Describe the purpose of this action.' },
		},
		required: ['purpose'],
	}
}

/**
 * Bounds a tool string at a character limit, appending a footer that names the cut and the
 * caller's closing clause.
 *
 * @remarks
 * A string within the limit returns unchanged. Otherwise the cut text plus footer fits `limit`
 * UTF-16 code units, without splitting a surrogate pair. When the character-range footer cannot
 * fit, the result ends with an ellipsis instead. The footer has no default: each caller states
 * what the reader does next. Numbered windows select whole rows through `renderBrowserWindow`.
 *
 * @param text - The page-authored or composed string
 * @param limit - The whole-result character limit, a positive integer
 * @param footer - The clause that closes the footer after the character range
 * @returns The string, cut and footed when it exceeds the limit
 * @throws Thrown when `limit` is not a positive integer.
 *
 * @example
 * ```ts
 * import { boundBrowserText } from '@orkestrel/browser'
 *
 * boundBrowserText('abcdef', 4, 'the rest was cut') // 'abc…'
 * boundBrowserText('abc', 4, 'the rest was cut') // 'abc'
 * ```
 */
export function boundBrowserText(text: string, limit: number, footer: string): string {
	if (!isInteger(limit) || limit < 1) {
		throw new BrowserError('ARGUMENT', 'Browser tool limit must be a positive integer', { limit })
	}
	if (text.length <= limit) return text
	let end = limit
	for (;;) {
		const suffix = `\n[characters 0–${end} of ${text.length}; ${footer}]`
		if (suffix.length >= limit) return abbreviateBrowserText(text, limit)
		if (end + suffix.length <= limit) return `${text.slice(0, end)}${suffix}`
		end = Math.max(0, limit - suffix.length)
		if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end -= 1
	}
}

/** Redacts registered secrets before projection wrapping or output clipping.
 * @param text - Unbounded text
 * @param secrets - Registered secret values
 * @returns Text with literal and JSON-escaped secret occurrences replaced
 */
export function redactBrowserText(text: string, secrets: readonly string[]): string {
	for (const secret of [
		...new Set(secrets.flatMap((value) => [value, normalizeBrowserName(value)])),
	].sort((left, right) => right.length - left.length)) {
		if (secret === '') continue
		text = text
			.replaceAll(JSON.stringify(secret), '[redacted]')
			.replaceAll(JSON.stringify(secret).slice(1, -1), '[redacted]')
			.replaceAll(secret, '[redacted]')
	}
	return text
}

/**
 * Refuses a tool call that carries a parameter its definition does not advertise, naming the
 * parameters the tool takes.
 *
 * @param definition - The advertised tool definition whose `parameters.properties` names the
 * accepted keys
 * @param args - The arguments a model supplied
 * @throws Thrown as a `BrowserError` coded `ARGUMENT`, with the refused key in its
 * context, when an argument key is not an advertised parameter.
 *
 * @example
 * ```ts
 * import { BROWSER_TOOL_COPY, validateBrowserToolArguments } from '@orkestrel/browser'
 *
 * validateBrowserToolArguments(BROWSER_TOOL_COPY.read, { search: 'cart', ref: 'e1' })
 * // throws 'The read tool takes no ref parameter; call read with from, to, and search.'
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
		'ARGUMENT',
		`The ${definition.name} tool takes no ${key} parameter; call ${definition.name} with ${accepted}.`,
		{ subject: 'toolset', key },
	)
}

/**
 * Renders an element as its outline row reads: role, quoted name, and reference.
 *
 * @param element - The referenced element
 * @returns The role, optional JSON-quoted name, and `[ref=eN]` reference
 *
 * @example
 * ```ts
 * import { renderBrowserElement } from '@orkestrel/browser'
 *
 * const element = page.elements.element('e4')
 * if (element !== undefined) renderBrowserElement(element) // 'button "Place order" [ref=e4]'
 * ```
 */
export function renderBrowserElement(element: BrowserElementInterface): string {
	return `${element.role}${element.name === '' ? '' : ` ${JSON.stringify(element.name)}`} [ref=${element.reference}]`
}

/**
 * Requires a tool argument to be an element reference in any spelling `parseBrowserReference`
 * accepts, and returns its canonical form.
 *
 * @param value - The argument a model supplied
 * @returns The canonical reference, such as `e12`
 * @throws Thrown as a `BrowserError` with reason `UNKNOWN` when the value is not a
 * reference, naming `read` as the next call.
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
	if (reference === undefined) {
		const subject = `Reference ${JSON.stringify(value)}`
		throw new BrowserError(
			'ELEMENT',
			describeBrowserRefusal(
				{ subject },
				'UNKNOWN',
				'is not a reference such as e12; call read for fresh refs',
			),
			{ subject, reason: 'UNKNOWN' },
		)
	}
	return reference
}

/**
 * Reads a required string argument from a tool call.
 *
 * @param args - The arguments a model supplied
 * @param key - The parameter name
 * @returns The string the argument holds
 * @throws Thrown as a `BrowserError` coded `ARGUMENT` when the argument is not a
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
		throw new BrowserError('ARGUMENT', `The ${key} parameter must be a string.`, {
			subject: 'toolset',
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
 * 	action: 'Clicked button "Delete" [ref=e7]',
 * 	dialog: { category: 'confirm', message: 'Delete the draft?' },
 * })
 * // 'Clicked button "Delete" [ref=e7]. A confirm dialog is open: "Delete the draft?"; call dialog.'
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
export function buildBrowserHAREntry(
	pending: {
		readonly request: BrowserRequest
		readonly started: number
		readonly response: BrowserResponse | undefined
	},
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
			bodySize: post === undefined ? 0 : new TextEncoder().encode(post).byteLength,
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
		throw new BrowserError('ARGUMENT', 'Browser HAR document is malformed')
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
			throw new BrowserError('ARGUMENT', 'Browser HAR entry is malformed', { index })
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
				throw new BrowserError('ARGUMENT', 'Browser HAR request cookie is malformed', {
					index,
					cookie: cookieIndex,
				})
			}
		}
		for (const [headerIndex, header] of entry['request']['headers'].entries()) {
			if (!isRecord(header) || !isString(header['name']) || !isString(header['value'])) {
				throw new BrowserError('ARGUMENT', 'Browser HAR request header is malformed', {
					index,
					header: headerIndex,
				})
			}
		}
		for (const [queryIndex, query] of entry['request']['queryString'].entries()) {
			if (!isRecord(query) || !isString(query['name']) || !isString(query['value'])) {
				throw new BrowserError('ARGUMENT', 'Browser HAR query value is malformed', {
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
			throw new BrowserError('ARGUMENT', 'Browser HAR request body is malformed', { index })
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
				throw new BrowserError('ARGUMENT', 'Browser HAR response cookie is malformed', {
					index,
					cookie: cookieIndex,
				})
			}
		}
		for (const [headerIndex, header] of entry['response']['headers'].entries()) {
			if (!isRecord(header) || !isString(header['name']) || !isString(header['value'])) {
				throw new BrowserError('ARGUMENT', 'Browser HAR response header is malformed', {
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
			(encoding === 'base64' && (text === undefined || decodeBase64(text) === undefined))
		) {
			throw new BrowserError('ARGUMENT', 'Browser HAR response content is malformed', { index })
		}
		for (const name of ['blocked', 'dns', 'connect', 'send', 'wait', 'receive', 'ssl']) {
			const timing = entry['timings'][name]
			if (!isFiniteNumber(timing) || timing < -1) {
				throw new BrowserError('ARGUMENT', 'Browser HAR timing is malformed', {
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
		throw new BrowserError('PROTOCOL', 'Browser init script identifier is malformed')
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
		throw new BrowserError('ARGUMENT', 'Browser input coordinates must be finite', {
			point: { ...point },
		})
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
		throw new BrowserError('ARGUMENT', 'Browser input delay must be non-negative and finite', {
			delay: options.delay,
		})
	}
	if (options?.count !== undefined && (!isInteger(options.count) || options.count <= 0)) {
		throw new BrowserError('ARGUMENT', 'Browser click count must be a positive integer', {
			count: options.count,
		})
	}
	if (options?.steps !== undefined && (!isInteger(options.steps) || options.steps <= 0)) {
		throw new BrowserError('ARGUMENT', 'Browser drag steps must be a positive integer', {
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
		throw new BrowserError('ARGUMENT', 'Browser timeout must be a non-negative finite number', {
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
		throw new BrowserError('ARGUMENT', 'Browser viewport dimensions must be positive integers', {
			viewport: { ...viewport },
		})
	}
	if (viewport.scale !== undefined && (!isFiniteNumber(viewport.scale) || viewport.scale <= 0)) {
		throw new BrowserError('ARGUMENT', 'Browser viewport scale must be positive and finite', {
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
		throw new BrowserError('ARGUMENT', 'Browser user agent cannot be empty')
	}
	if (options.locale !== undefined && options.locale.length === 0) {
		throw new BrowserError('ARGUMENT', 'Browser locale cannot be empty')
	}
	if (options.timezone !== undefined && options.timezone.length === 0) {
		throw new BrowserError('ARGUMENT', 'Browser timezone cannot be empty')
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
			throw new BrowserError('ARGUMENT', 'Browser geolocation is outside valid coordinate bounds', {
				location: { ...location },
			})
		}
	}
	for (const name of Object.keys(options.headers ?? {})) {
		if (name.length === 0) throw new BrowserError('ARGUMENT', 'Browser header name cannot be empty')
	}
}

/**
 * Validates isolated-context options before creating remote state.
 *
 * @param options - Public context configuration
 */
export function validateBrowserContextOptions(options?: BrowserIsolateOptions): void {
	if (options === undefined) return
	if (options.viewport !== undefined) validateBrowserViewport(options.viewport)
	if (options.emulation !== undefined) validateBrowserEmulationOptions(options.emulation)
	if (options.proxy !== undefined) {
		if (options.proxy.server.length === 0) {
			throw new BrowserError('ARGUMENT', 'Browser proxy server cannot be empty')
		}
		if (options.proxy.bypass?.some((entry) => entry.length === 0) === true) {
			throw new BrowserError('ARGUMENT', 'Browser proxy bypass entries cannot be empty')
		}
	}
	for (const origin of options.origins ?? []) {
		const result = attempt(() => new URL(origin))
		if (!result.success) {
			throw new BrowserError('ARGUMENT', 'Browser context origin must be valid', { origin })
		}
		const url = result.value
		if (
			(url.protocol !== 'http:' && url.protocol !== 'https:') ||
			url.origin !== origin.replace(/\/$/, '')
		) {
			throw new BrowserError(
				'ARGUMENT',
				'Browser context origin must be an absolute HTTP(S) origin',
				{
					origin,
				},
			)
		}
	}
	if (options.downloads !== undefined && options.downloads.path.length === 0) {
		throw new BrowserError('ARGUMENT', 'Browser download path cannot be empty')
	}
}

/**
 * Validates Accessibility-domain snapshot bounds.
 *
 * @param options - Public accessibility snapshot options
 */
export function validateBrowserAccessibilityOptions(options?: BrowserAccessibilityOptions): void {
	if (options?.root !== undefined && (!isInteger(options.root) || options.root <= 0)) {
		throw new BrowserError('ARGUMENT', 'Browser accessibility root must be a positive integer', {
			root: options.root,
		})
	}
	if (options?.depth !== undefined && (!isInteger(options.depth) || options.depth < 0)) {
		throw new BrowserError(
			'ARGUMENT',
			'Browser accessibility depth must be a non-negative integer',
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
			throw new BrowserError('ARGUMENT', 'Browser screenshot quality is only valid for JPEG')
		}
		if (!isInteger(options.quality) || options.quality < 0 || options.quality > 100) {
			throw new BrowserError(
				'ARGUMENT',
				'Browser screenshot quality must be an integer from 0 to 100',
			)
		}
	}
	if (options?.full === true && options.clip !== undefined) {
		throw new BrowserError(
			'ARGUMENT',
			'Browser screenshot cannot combine full-page and clip capture',
		)
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
		throw new BrowserError('ARGUMENT', `${field} is outside its valid range`, {
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
		throw new BrowserError('PROTOCOL', 'Browser accessibility tree is malformed')
	}
	const nodes: BrowserAXNode[] = []
	for (const [index, candidate] of value['nodes'].entries()) {
		if (!isRecord(candidate) || !isString(candidate['nodeId'])) {
			throw new BrowserError('PROTOCOL', 'Browser accessibility node is malformed', { index })
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
		throw new BrowserError('PROTOCOL', 'Browser IO stream chunk is malformed')
	}
	const bytes =
		value['base64Encoded'] === true
			? decodeBase64(value['data'])
			: new TextEncoder().encode(value['data'])
	if (bytes === undefined)
		throw new BrowserError('PROTOCOL', 'Browser IO stream chunk has malformed base64 data')
	return {
		bytes,
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
		throw new BrowserError('PROTOCOL', 'Browser JavaScript coverage is malformed')
	}
	return value['result'].map((script, index) => {
		if (
			!isRecord(script) ||
			!isString(script['scriptId']) ||
			!isString(script['url']) ||
			!isArray(script['functions'])
		) {
			throw new BrowserError('PROTOCOL', 'Browser script coverage entry is malformed', { index })
		}
		const functions: BrowserFunctionCoverage[] = script['functions'].map((entry, functionIndex) => {
			if (!isRecord(entry) || !isString(entry['functionName']) || !isArray(entry['ranges'])) {
				throw new BrowserError('PROTOCOL', 'Browser function coverage entry is malformed', {
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
		throw new BrowserError('PROTOCOL', 'Browser CSS coverage is malformed')
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
			throw new BrowserError('PROTOCOL', 'Browser CSS coverage entry is malformed', { index })
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
		throw new BrowserError('PROTOCOL', 'Browser coverage ranges are malformed', { script })
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
			throw new BrowserError('PROTOCOL', 'Browser coverage range is malformed', {
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
		throw new BrowserError('PROTOCOL', 'Browser performance metrics are malformed')
	}
	return value['metrics'].map((metric, index) => {
		if (!isRecord(metric) || !isString(metric['name']) || !isFiniteNumber(metric['value'])) {
			throw new BrowserError('PROTOCOL', 'Browser performance metric is malformed', { index })
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
		throw new BrowserError('PROTOCOL', 'Browser CPU profile is malformed')
	}
	const profile = value['profile']
	if (
		!isFiniteNumber(profile['startTime']) ||
		!isFiniteNumber(profile['endTime']) ||
		profile['endTime'] < profile['startTime'] ||
		!isArray(profile['nodes'])
	) {
		throw new BrowserError('PROTOCOL', 'Browser CPU profile metadata is malformed')
	}
	const nodes: BrowserProfileNode[] = profile['nodes'].map((node, index) => {
		if (
			!isRecord(node) ||
			!isInteger(node['id']) ||
			node['id'] < 0 ||
			(node['hitCount'] !== undefined && (!isInteger(node['hitCount']) || node['hitCount'] < 0))
		) {
			throw new BrowserError('PROTOCOL', 'Browser CPU profile node is malformed', { index })
		}
		const children = node['children'] === undefined ? [] : parseArray(node['children'], isInteger)
		if (children === undefined || children.some((child) => child < 0)) {
			throw new BrowserError('PROTOCOL', 'Browser CPU profile node is malformed', { index })
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
		throw new BrowserError('PROTOCOL', 'Browser CPU profile samples are malformed')
	}
	const deltas =
		profile['timeDeltas'] === undefined ? [] : parseArray(profile['timeDeltas'], isFiniteNumber)
	if (deltas === undefined || deltas.some((delta) => delta < 0)) {
		throw new BrowserError('PROTOCOL', 'Browser CPU profile deltas are malformed')
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
		throw new BrowserError('PROTOCOL', 'Browser CPU profile call frame is malformed', { node })
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
	if (cookie.name.length === 0)
		throw new BrowserError('ARGUMENT', 'Browser cookie name cannot be empty')
	if (cookie.url === undefined && (cookie.domain === undefined || cookie.path === undefined)) {
		throw new BrowserError('ARGUMENT', 'Browser cookie requires either url or domain with path', {
			name: cookie.name,
		})
	}
	if (cookie.url !== undefined && !URL.canParse(cookie.url)) {
		throw new BrowserError('ARGUMENT', 'Browser cookie URL must be valid', {
			name: cookie.name,
			url: cookie.url,
		})
	}
	if (cookie.expires !== undefined && !isFiniteNumber(cookie.expires)) {
		throw new BrowserError('ARGUMENT', 'Browser cookie expiry must be finite', {
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
		throw new BrowserError('PROTOCOL', 'Browser cookie result is malformed')
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
		throw new BrowserError('PROTOCOL', 'Browser cookie is malformed', { index })
	}
	const sameSite = parseEnum(value['sameSite'], ['Strict', 'Lax', 'None'])
	if (value['sameSite'] !== undefined && sameSite === undefined) {
		throw new BrowserError('PROTOCOL', 'Browser cookie same-site policy is malformed', { index })
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
		throw new BrowserError('ARGUMENT', 'Browser cookie URL must be valid', { url: value })
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
		throw new BrowserError('PROTOCOL', 'Browser storage result is malformed', { origin })
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
		throw new BrowserError('PROTOCOL', 'Browser storage entries are malformed', { origin, storage })
	}
	return value.map((entry, index) => {
		if (!isRecord(entry) || !isString(entry['name']) || !isString(entry['value'])) {
			throw new BrowserError('PROTOCOL', 'Browser storage entry is malformed', {
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
 * and a `BrowserError` past the guarded result size.
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
				throw new BrowserError('RESULT_LIMIT', 'Evaluation result exceeds BROWSER_RESULT_LIMIT', {
					length: Number(limitMatch[1]),
					limit: BROWSER_RESULT_LIMIT,
				})
			}
			throw new BrowserError('PROTOCOL', description)
		}
		throw new BrowserError('PROTOCOL', 'JavaScript evaluation failed')
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
	throw new BrowserError('PROTOCOL', `${field} failed: no string value returned`)
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
	throw new BrowserError('PROTOCOL', 'Failed to create frame execution context', { frame })
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
		throw new BrowserError('ARGUMENT', 'Browser read offset must be a non-negative integer', {
			offset,
		})
	}
	if (limit !== undefined && (!isInteger(limit) || limit < 1)) {
		throw new BrowserError('ARGUMENT', 'Browser read limit must be a positive integer', { limit })
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
		throw new BrowserError('PROTOCOL', 'Element has no content quad')
	}
	const points = parseNumberArray(value['quads'][0])
	if (points === undefined || points.length !== 8) {
		throw new BrowserError('PROTOCOL', 'Element has a malformed content quad')
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
		throw new BrowserError('PROTOCOL', 'Element has a malformed content quad')
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
	if (key === undefined) throw new BrowserError('ARGUMENT', 'Browser key chord is empty')
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
			throw new BrowserError('ARGUMENT', `Unsupported browser key modifier: ${modifier}`)
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
	if ([...value].length !== 1)
		throw new BrowserError('ARGUMENT', `Unsupported browser key: ${value}`)
	const character = [...value][0]
	if (character === undefined) throw new BrowserError('ARGUMENT', 'Browser key is empty')
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
 * `BrowserSnapshotInput`, throwing a `BrowserError` off-shape and a `BrowserError`
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
		throw new BrowserError('ARGUMENT', 'Browser snapshot limit must be a non-negative integer', {
			limit,
		})
	}
	if (!isRecord(value) || !isArray(value['strings']) || !isArray(value['documents'])) {
		throw new BrowserError('PROTOCOL', 'Malformed DOMSnapshot.captureSnapshot result')
	}
	const strings = parseArray(value['strings'], isString)
	if (strings === undefined) {
		throw new BrowserError('PROTOCOL', 'Malformed DOMSnapshot string table')
	}
	let count = 0
	for (const document of value['documents']) {
		if (!isRecord(document) || !isRecord(document['nodes'])) continue
		count += parseNumberArray(document['nodes']['nodeType'])?.length ?? 0
	}
	if (count > limit) {
		throw new BrowserError('RESULT_LIMIT', 'DOM snapshot exceeds the configured node limit', {
			length: count,
			limit,
		})
	}

	const documents: BrowserDocument[] = []
	for (let documentIndex = 0; documentIndex < value['documents'].length; documentIndex += 1) {
		const rawDocument = value['documents'][documentIndex]
		if (!isRecord(rawDocument) || !isRecord(rawDocument['nodes'])) {
			throw new BrowserError('PROTOCOL', 'Malformed DOM snapshot document', {
				document: documentIndex,
			})
		}

		const rawNodes = rawDocument['nodes']
		const frame = parseSnapshotString(strings, rawDocument['frameId'])
		const url = parseSnapshotString(strings, rawDocument['documentURL'])
		const title =
			rawDocument['title'] === -1 ? '' : parseSnapshotString(strings, rawDocument['title'])
		if (frame === undefined || url === undefined || title === undefined) {
			throw new BrowserError('PROTOCOL', 'Malformed DOM snapshot document metadata', {
				document: documentIndex,
			})
		}
		const types = parseNumberArray(rawNodes['nodeType'])
		const names = parseNumberArray(rawNodes['nodeName'])
		const values = parseNumberArray(rawNodes['nodeValue'])
		if (types === undefined || names === undefined || values === undefined) {
			throw new BrowserError('PROTOCOL', 'Malformed DOM snapshot node table', {
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
				throw new BrowserError('PROTOCOL', 'Malformed DOM snapshot node', {
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
 * Applies an ordered edit batch to a copy and validates its nonempty result and final bindings.
 * @param journey - Valid journey to edit
 * @param edits - Edits in application order
 * @returns The edited journey, with unbound parameters removed
 * @throws BrowserError - Thrown with JOURNEY_EDIT, a one-based index, and a reason clause when the batch fails
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
	let removal = 0
	const declarations = new Map<string, number>()
	const origins = new Map<string, number>()
	const secrets = new Map<string, number>()
	try {
		for (const edit of edits) {
			index += 1
			validateBrowserJourneyEdit(edit)
			switch (edit.operation) {
				case 'add': {
					const anchor = edit.before ?? edit.after
					const position =
						anchor === undefined ? steps.length : steps.findIndex((step) => step.id === anchor)
					if (position < 0) throw new BrowserError('ARGUMENT', `names unknown anchor "${anchor}"`)
					const step = { ...edit.step, id: `s${next}` }
					next += 1
					if (!Number.isSafeInteger(next))
						throw new BrowserError('ARGUMENT', 'Invariant 2 (ids): has an invalid next counter')
					for (const field of [...Object.keys(step.arguments), 'target.name'])
						origins.set(step.id + '.' + field, index)
					steps.splice(position + (edit.after === undefined ? 0 : 1), 0, step)
					break
				}
				case 'remove':
				case 'update': {
					const position = steps.findIndex((step) => step.id === edit.id)
					const step = steps[position]
					if (step === undefined)
						throw new BrowserError('ARGUMENT', `names unknown step "${edit.id}"`)
					if (edit.operation === 'remove') {
						steps.splice(position, 1)
						removal = index
					} else {
						const updated = {
							...step,
							arguments: { ...step.arguments, ...edit.arguments },
							...(edit.target === undefined ? {} : { target: edit.target }),
							...(edit.tab === undefined ? {} : { tab: edit.tab }),
						}
						validateBrowserJourneyStep(updated)
						const fields = [
							...Object.entries(edit.arguments ?? {}),
							...(edit.target === undefined ? [] : [['target.name', edit.target.name]]),
						]
						for (const [field, value] of fields) {
							if (!isString(field)) continue
							const previous = field === 'target.name' ? step.target?.name : step.arguments[field]
							if (JSON.stringify(previous) !== JSON.stringify(value))
								origins.set(step.id + '.' + field, index)
						}
						steps[position] = updated
					}
					break
				}
				case 'declare':
					if (edit.parameter.secret !== parameters[edit.name]?.secret) secrets.set(edit.name, index)
					parameters = { ...parameters, [edit.name]: edit.parameter }
					declarations.set(edit.name, index)
			}
		}
		if (steps.length === 0) {
			index = removal
			throw new BrowserError('ARGUMENT', 'removes the last step')
		}
		const bindings = collectBrowserJourneyBindings(steps)
		for (const [name, declaration] of declarations) {
			if (!bindings.has(name)) {
				index = declaration
				throw new BrowserError('ARGUMENT', `declares "${name}" but no step binds it`)
			}
		}
		parameters = Object.fromEntries(
			Object.entries(parameters).filter(([name]) => bindings.has(name)),
		)
		const candidate = { ...journey, steps, parameters, next }
		try {
			validateBrowserJourney(candidate)
		} catch (error) {
			if (isBrowserError(error) && isBrowserJourneyValidationContext(error.context)) {
				const { parameter, step, field } = error.context
				index = Math.max(origins.get(step + '.' + field) ?? 0, secrets.get(parameter) ?? 0)
			}
			throw error
		}
		return structuredClone(candidate)
	} catch (error) {
		const reason = normalizeBrowserJourneyReason(error)
		throw new BrowserError(
			'JOURNEY_EDIT',
			`Edit ${index} is refused: ${reason.startsWith('its ') ? reason : `it ${reason}`}`,
			{
				index,
				reason,
			},
		)
	}
}

/**
 * Checks a journey name before store access.
 * @param name - Journey name
 * @throws BrowserError - Thrown with STORE_PATH when the name is invalid
 * @example
 * validateBrowserJourneyName('add-kettle')
 */
export function validateBrowserJourneyName(name: string): void {
	if (!BROWSER_JOURNEY_NAME_PATTERN.test(name))
		throw new BrowserError('STORE_PATH', `Refused journey name: ${name}`)
}

/**
 * Checks the offset and limit of a store page.
 * @param offset - Nonnegative safe integer offset
 * @param limit - Positive safe integer limit
 * @throws BrowserError - Thrown with ARGUMENT when either bound is invalid
 * @example
 * validateBrowserStorePage(0, 10)
 */
export function validateBrowserStorePage(offset: number, limit: number): void {
	if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1)
		throw new BrowserError(
			'ARGUMENT',
			'Paging requires a nonnegative integer offset and a positive integer limit',
			{ subject: 'store' },
		)
}

/**
 * Normalizes a failure to its first paragraph without an invariant label, directive, or final period.
 * @param error - Failure or reason text
 * @returns Reason clause
 * @example
 * normalizeBrowserJourneyReason(new Error('Invariant 4 (bindings): has an invalid binding.'))
 */
export function normalizeBrowserJourneyReason(error: unknown): string {
	return renderBrowserRunResult(error instanceof Error ? error.message : String(error))
		.replace(/^Invariant \d+ \([^)]*\): /, '')
		.replace(/\.+$/, '')
}

/**
 * Renders an unreadable journey from its name and path-free reason.
 * @param fault - Structured store fault
 * @returns Listing fault line
 * @example
 * renderBrowserJourneyFault({ name: 'add-kettle', reason: 'Malformed journey revision' })
 */
export function renderBrowserJourneyFault(fault: BrowserStoreFault): string {
	return `${fault.name} cannot be read: ${fault.reason}`
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
	throw new BrowserError('JOURNEY_INPUT', 'A journey binding has no value')
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
				const secret = isBrowserSecretBinding(step, journey.parameters)
				return `${step.id} type ${secret ? '(secret)' : JSON.stringify(text)}${suffix} into ${name}${step.arguments['submit'] === true ? ', submit' : ''}`
			}
			case 'press':
				return `${step.id} press ${text}${suffix}`
			case 'wait':
				return `${step.id} wait ${JSON.stringify(text)}${suffix}${step.arguments['absent'] === true ? ', absent' : ''}`
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
 * Collects the parameter names a native `type` step's `text` binds.
 *
 * @remarks
 * The names are the bindings `collectBrowserJourneyBindings` reports under `type.text`, so a page
 * tool's literal `text` argument binds no name. A recorder reads them as the names a derived
 * secret parameter cannot take.
 *
 * @param steps - Recorded steps
 * @returns Each bound name once, in the order `collectBrowserJourneyBindings` reports it
 */
export function collectBrowserJourneyTextBindings(
	steps: readonly BrowserJourneyStepInput[],
): readonly string[] {
	return [...collectBrowserJourneyBindings(steps)]
		.filter(([, fields]) => fields.includes('type.text'))
		.map(([name]) => name)
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

/**
 * Validates a parameter declaration, including the secret-default exclusion.
 * @param value - Candidate declaration
 * @throws BrowserError - Thrown when invariant 5 or the declaration shape fails
 */
export function validateBrowserJourneyParameter(
	value: unknown,
): asserts value is BrowserJourneyParameter {
	if (
		!isRecord(value) ||
		!isJSONValue(value) ||
		Object.keys(value).some((key) => key !== 'default' && key !== 'secret') ||
		(value['default'] !== undefined && !isString(value['default'])) ||
		(value['secret'] !== undefined && !isBoolean(value['secret']))
	) {
		throw new BrowserError(
			'JOURNEY_INVALID',
			'Invariant 5 (secrets): has a malformed parameter declaration',
		)
	}
	if (value['secret'] === true && value['default'] !== undefined)
		throw new BrowserError(
			'JOURNEY_INVALID',
			'Invariant 5 (secrets): declares a secret with a default',
		)
}

/**
 * Validates one step independently of ids and parameter declarations.
 * @param value - Candidate step
 * @throws BrowserError - Thrown when the action, target, tab, arguments, or JSON shape fails
 */
export function validateBrowserJourneyStep(
	value: unknown,
): asserts value is BrowserJourneyStepInput {
	if (
		!isJSONValue(value) ||
		!isRecord(value) ||
		!isString(value['action']) ||
		!isRecord(value['arguments'])
	)
		throw new BrowserError('JOURNEY_INVALID', 'Invariant 6 (JSON round trip): has a malformed step')
	const action = value['action']
	if (action.length === 0 || BROWSER_JOURNEY_NON_STEP_TOOLS.includes(action))
		throw new BrowserError(
			'JOURNEY_INVALID',
			'Invariant 7 (actions): uses an observation or journey tool as a step',
		)
	const native = BROWSER_JOURNEY_ACTIONS.some((name) => name === action)
	const targeted = action === 'click' || action === 'type'
	if (
		(targeted ? !isBrowserJourneyTarget(value['target']) : value['target'] !== undefined) ||
		(action === 'switch' ? !isBrowserJourneyTab(value['tab']) : value['tab'] !== undefined)
	)
		throw new BrowserError(
			'JOURNEY_INVALID',
			'Invariant 3 (targets and tabs): has an incompatible target or tab',
		)
	const args = value['arguments']
	if (native && ('ref' in args || 'tab' in args))
		throw new BrowserError(
			'JOURNEY_INVALID',
			'Invariant 3 (targets and tabs): carries ref or tab in native arguments',
		)
	if (
		action === 'unresolved'
			? !isString(value['gap']) || value['gap'].length === 0
			: value['gap'] !== undefined
	)
		throw new BrowserError('JOURNEY_INVALID', 'Invariant 7 (actions): has an incompatible gap')
	if (!native) return
	const name = BROWSER_JOURNEY_ACTIONS.find((candidate) => candidate === action)
	if (name === undefined) return
	const schema = BROWSER_TOOL_COPY[name].parameters
	const properties = schema?.['properties']
	const required = schema?.['required']
	const fields = isRecord(properties)
		? Object.entries(properties).filter(([key]) => !BROWSER_JOURNEY_STEP_KEYS.includes(key))
		: []
	if (
		Object.keys(args).some((key) => !fields.some(([field]) => field === key)) ||
		fields.some(([key, property]) => {
			const argument = args[key]
			if (argument === undefined) return isArray(required) && required.includes(key)
			if (!isRecord(property)) return true
			switch (property['type']) {
				case 'string':
					return !isBrowserJourneyBinding(argument)
				case 'boolean':
					return !isBoolean(argument)
				case 'integer':
					return !isInteger(argument)
				case 'number':
					return !isFiniteNumber(argument)
				default:
					return true
			}
		})
	)
		throw new BrowserError(
			'JOURNEY_INVALID',
			'Invariant 7 (actions): has malformed native arguments',
		)
}

/**
 * Validates the journey format and its name, nonempty steps, ids, bindings, secrets, JSON, and actions.
 * @param value - Candidate journey
 * @throws BrowserError - Thrown with STORE_FORMAT for an unknown format, or JOURNEY_INVALID naming the failed invariant
 */
export function validateBrowserJourney(value: unknown): asserts value is BrowserJourney {
	if (!isJSONValue(value) || !isRecord(value))
		throw new BrowserError('JOURNEY_INVALID', 'Invariant 6 (JSON round trip): is not a JSON record')
	if (value['format'] !== BROWSER_JOURNEY_FORMAT_VERSION)
		throw new BrowserError('STORE_FORMAT', 'Has an unknown journey format')
	if (!isString(value['name']) || !BROWSER_JOURNEY_NAME_PATTERN.test(value['name']))
		throw new BrowserError('JOURNEY_INVALID', 'Invariant 1 (name): has an invalid journey name')
	if (!isString(value['description']) || !isArray(value['steps']) || !isRecord(value['parameters']))
		throw new BrowserError(
			'JOURNEY_INVALID',
			'Invariant 6 (JSON round trip): has malformed journey fields',
		)
	if (value['steps'].length === 0)
		throw new BrowserError('JOURNEY_INVALID', 'Invariant 2 (ids): has no steps', {
			field: 'steps',
		})
	if (!Number.isSafeInteger(value['next']) || !isFiniteNumber(value['next']) || value['next'] < 1)
		throw new BrowserError('JOURNEY_INVALID', 'Invariant 2 (ids): has an invalid next counter')
	const ids = new Set<string>()
	const steps: BrowserJourneyStep[] = []
	for (const step of value['steps']) {
		validateBrowserJourneyStep(step)
		if (
			!('id' in step) ||
			!isString(step.id) ||
			!/^s[1-9]\d*$/.test(step.id) ||
			!Number.isSafeInteger(Number(step.id.slice(1))) ||
			Number(step.id.slice(1)) >= value['next'] ||
			ids.has(step.id)
		)
			throw new BrowserError(
				'JOURNEY_INVALID',
				'Invariant 2 (ids): repeats an id or exceeds the next counter',
			)
		ids.add(step.id)
		steps.push({ ...step, id: step.id })
	}
	const bindings = collectBrowserJourneyBindings(steps)
	for (const [name, parameter] of Object.entries(value['parameters'])) {
		if (!BROWSER_JOURNEY_PARAMETER_PATTERN.test(name))
			throw new BrowserError(
				'JOURNEY_INVALID',
				'Invariant 4 (bindings): has an invalid parameter name',
			)
		validateBrowserJourneyParameter(parameter)
		if (!bindings.has(name))
			throw new BrowserError(
				'JOURNEY_INVALID',
				`Invariant 4 (bindings): declares "${name}" but no step binds it`,
			)
	}
	for (const name of bindings.keys()) {
		const declared = Object.hasOwn(value['parameters'], name)
		const parameter = value['parameters'][name]
		if (declared) validateBrowserJourneyParameter(parameter)
		for (const step of steps) {
			const fields = collectBrowserJourneyBindings([step]).get(name) ?? []
			for (const binding of fields) {
				const field = binding.slice(step.action.length + 1)
				const context = { parameter: name, step: step.id, field }
				if (!declared)
					throw new BrowserError(
						'JOURNEY_INVALID',
						`Invariant 4 (bindings): binds undeclared parameter "${name}"`,
						context,
					)
				if (
					isRecord(parameter) &&
					parameter['secret'] === true &&
					(step.action !== 'type' || field !== 'text')
				)
					throw new BrowserError(
						'JOURNEY_INVALID',
						`Invariant 5 (secrets): binds secret "${name}" outside type.text`,
						context,
					)
			}
		}
	}
}

/**
 * Validates an edit structure and names the operation and field in each refusal.
 * @param value - Candidate edit
 * @throws BrowserError - Thrown when the operation or its fields are malformed
 */
export function validateBrowserJourneyEdit(value: unknown): asserts value is BrowserJourneyEdit {
	if (!isRecord(value))
		throw new BrowserError('JOURNEY_EDIT', 'has no edit object with an "operation" field')
	const operation = value['operation']
	const fields =
		operation === 'add'
			? ['operation', 'step', 'before', 'after']
			: operation === 'remove'
				? ['operation', 'id']
				: operation === 'update'
					? ['operation', 'id', 'arguments', 'target', 'tab']
					: operation === 'declare'
						? ['operation', 'name', 'parameter']
						: undefined
	if (fields === undefined)
		throw new BrowserError(
			'JOURNEY_EDIT',
			'names no operation among add, update, remove, and declare',
		)
	for (const [field, content] of Object.entries(value)) {
		if (!fields.includes(field))
			throw new BrowserError(
				'JOURNEY_EDIT',
				`its "${operation}" carries an unknown field ${JSON.stringify(field)}`,
			)
		if (!isJSONValue(content))
			throw new BrowserError(
				'JOURNEY_EDIT',
				`its "${operation}" has non-JSON content in ${JSON.stringify(field)}`,
			)
	}
	switch (operation) {
		case 'add':
			if (value['before'] !== undefined && value['after'] !== undefined)
				throw new BrowserError('JOURNEY_EDIT', 'its "add" carries both "before" and "after"')
			for (const field of ['before', 'after']) {
				if (value[field] !== undefined && (!isString(value[field]) || value[field].length === 0))
					throw new BrowserError('JOURNEY_EDIT', `its "add" has no step id in "${field}"`)
			}
			try {
				validateBrowserJourneyStep(value['step'])
			} catch (error) {
				throw new BrowserError(
					'JOURNEY_EDIT',
					`its "add" has an invalid "step": ${normalizeBrowserJourneyReason(error)}`,
				)
			}
			if ('id' in value['step'])
				throw new BrowserError(
					'JOURNEY_EDIT',
					'its "add" supplies "step.id", which is assigned automatically',
				)
			return
		case 'remove':
			if (!isString(value['id']) || value['id'].length === 0)
				throw new BrowserError('JOURNEY_EDIT', 'its "remove" names no step in "id"')
			return
		case 'update':
			if (!isString(value['id']) || value['id'].length === 0)
				throw new BrowserError('JOURNEY_EDIT', 'its "update" names no step in "id"')
			if (value['arguments'] !== undefined && !isRecord(value['arguments']))
				throw new BrowserError('JOURNEY_EDIT', 'its "update" has no object in "arguments"')
			if (value['target'] !== undefined && !isBrowserJourneyTarget(value['target']))
				throw new BrowserError('JOURNEY_EDIT', 'its "update" has an invalid "target"')
			if (value['tab'] !== undefined && !isBrowserJourneyTab(value['tab']))
				throw new BrowserError('JOURNEY_EDIT', 'its "update" has an invalid "tab"')
			return
		case 'declare':
			if (!isString(value['name']) || value['name'].length === 0)
				throw new BrowserError('JOURNEY_EDIT', 'its "declare" has no "name"')
			if (!BROWSER_JOURNEY_PARAMETER_PATTERN.test(value['name']))
				throw new BrowserError('JOURNEY_EDIT', 'its "declare" has an invalid "name"')
			try {
				validateBrowserJourneyParameter(value['parameter'])
			} catch (error) {
				throw new BrowserError(
					'JOURNEY_EDIT',
					`its "declare" has an invalid "parameter": ${normalizeBrowserJourneyReason(error)}`,
				)
			}
			return
	}
}

/**
 * Validates a persisted run and the journey it carries.
 * @param value - Candidate run
 * @throws BrowserError - Thrown when the format, run fields, or embedded journey fails validation
 */
export function validateBrowserRun(value: unknown): asserts value is BrowserRun {
	if (!isJSONValue(value) || !isRecord(value))
		throw new BrowserError('JOURNEY_INVALID', 'Run is not a JSON record')
	if (value['format'] !== BROWSER_JOURNEY_FORMAT_VERSION)
		throw new BrowserError('STORE_FORMAT', 'Has an unknown run format')
	validateBrowserJourney(value['journey'])
	const journey = value['journey']
	if (
		!isString(value['id']) ||
		!BROWSER_RUN_ID_PATTERN.test(value['id']) ||
		!isRecord(value['inputs']) ||
		!Object.values(value['inputs']).every(isString) ||
		!isArray(value['steps']) ||
		parseEnum(value['outcome'], ['complete', 'stopped', 'aborted']) === undefined ||
		!isFiniteNumber(value['elapsed']) ||
		value['elapsed'] < 0 ||
		(value['revision'] !== undefined &&
			(!isFiniteNumber(value['revision']) ||
				!Number.isSafeInteger(value['revision']) ||
				value['revision'] < 1)) ||
		(value['fault'] !== undefined && !isString(value['fault'])) ||
		(value['output'] !== undefined &&
			(!isArray(value['output']) || !value['output'].every(isString)))
	)
		throw new BrowserError('JOURNEY_INVALID', 'Run has malformed fields')
	for (const [index, step] of value['steps'].entries()) {
		const source = journey.steps[index]
		if (
			!isRecord(step) ||
			source === undefined ||
			step['id'] !== source.id ||
			step['action'] !== source.action ||
			!isString(step['trigger']) ||
			!isRecord(step['arguments']) ||
			!isString(step['result']) ||
			!isFiniteNumber(step['elapsed']) ||
			step['elapsed'] < 0 ||
			parseEnum(step['outcome'], BROWSER_ACTION_OUTCOMES) === undefined ||
			(step['capture'] !== undefined && !isString(step['capture'])) ||
			(step['stage'] !== undefined &&
				parseEnum(step['stage'], BROWSER_ACTION_STAGES) === undefined) ||
			(step['reason'] !== undefined &&
				parseEnum(step['reason'], BROWSER_NAVIGATION_REASONS) === undefined)
		)
			throw new BrowserError(
				'JOURNEY_INVALID',
				'Run has a malformed step or is not a journey prefix',
			)
	}
	for (const [name, parameter] of Object.entries(journey.parameters)) {
		if (
			parameter.secret === true &&
			(Object.hasOwn(value['inputs'], name) ||
				value['output'] !== undefined ||
				value['steps'].some((step) => isRecord(step) && step['capture'] !== undefined))
		)
			throw new BrowserError(
				'JOURNEY_INVALID',
				'Invariant 5 (secrets): run retains secret inputs, output, or captures',
			)
	}
	if (Object.keys(value['inputs']).some((name) => !Object.hasOwn(journey.parameters, name)))
		throw new BrowserError('JOURNEY_INVALID', 'Run has an unknown input')
	if (
		value['outcome'] === 'complete' &&
		(value['steps'].length !== journey.steps.length ||
			value['steps'].some((step, index) => {
				if (!isRecord(step)) return true
				const following = journey.steps[index + 1]
				return (
					(step['outcome'] !== 'done' &&
						!(step['outcome'] === 'interrupted' && following?.action === 'dialog')) ||
					(step['stage'] !== undefined && step['stage'] !== 'loaded')
				)
			}))
	)
		throw new BrowserError('JOURNEY_INVALID', 'Run completion does not match its steps')
	for (const [index, source] of journey.steps.entries()) {
		const step = value['steps'][index]
		if (
			isBrowserSecretBinding(source, journey.parameters) &&
			isRecord(step) &&
			isRecord(step['arguments']) &&
			Object.hasOwn(step['arguments'], 'text')
		)
			throw new BrowserError(
				'JOURNEY_INVALID',
				'Invariant 5 (secrets): run retains secret type.text',
			)
	}
}

/**
 * Builds a validated journey from recorded steps and declares their secret bindings.
 * @param steps - Recorded steps in order
 * @param options - Journey name and description
 * @returns An owned journey with its next id and secret declarations
 * @throws BrowserError - Thrown when the assembled journey fails validation
 */
export function buildBrowserJourney(
	steps: readonly BrowserJourneyStep[],
	options: BrowserJourneyInput,
): BrowserJourney {
	const parameters: Record<string, BrowserJourneyParameter> = {}
	for (const step of steps) {
		const binding = step.arguments['text']
		if (
			isBrowserJourneyBinding(binding) &&
			!isString(binding) &&
			isBrowserSecretBinding(step, { [binding.parameter]: { secret: true } })
		)
			parameters[binding.parameter] = { secret: true }
	}
	const journey: BrowserJourney = {
		format: BROWSER_JOURNEY_FORMAT_VERSION,
		...options,
		parameters,
		next: steps.length + 1,
		steps: structuredClone(steps),
	}
	validateBrowserJourney(journey)
	return journey
}

/**
 * Validates the mutually exclusive conditions of a journey write before side effects.
 * @param options - Conditional write and cancellation options
 * @throws Thrown with ARGUMENT for conflicting conditions or an invalid revision.
 * @example
 * validateBrowserJourneyWriteOptions({ exclusive: true })
 */
export function validateBrowserJourneyWriteOptions(options?: BrowserJourneyWriteOptions): void {
	if (
		options?.revision !== undefined &&
		(!Number.isSafeInteger(options.revision) || options.revision < 1)
	)
		throw new BrowserError('ARGUMENT', 'A journey revision must be a positive safe integer')
	if (options?.revision !== undefined && options.exclusive === true)
		throw new BrowserError('ARGUMENT', 'A journey write cannot combine revision and exclusive')
}

/**
 * Refuses work on a disconnected or closed page.
 * @param page - The page whose lifecycle permits the operation
 * @param client - The client's connection carrying the page
 * @throws Thrown with CLOSED when the client disconnected or the page closed.
 * @example
 * validateBrowserPageOpen(page, client)
 */
export function validateBrowserPageOpen(
	page: BrowserPageInterface,
	client: CDPClientInterface,
): void {
	if (!client.connected)
		throw new BrowserError('CLOSED', 'Browser frame is disconnected', { frame: page.id })
	if (page.closed) throw new BrowserError('CLOSED', 'Browser page is closed')
}
