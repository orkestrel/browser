import type {
	BrowserOutlineRowsInput,
	BrowserOutlineNode,
	BrowserLine,
	BrowserLineSpan,
} from './types.js'
import { isInteger } from '@orkestrel/contract'
import { BrowserOutlineAncestors } from './BrowserOutlineAncestors.js'
import {
	normalizeBrowserName,
	renderBrowserOutlineRow,
	belongsBrowserOutline,
	renderBrowserSpans,
	redactBrowserText,
	wrapBrowserLine,
} from './helpers.js'

/** Projects outline nodes into wrapped lines while retaining listing totals and focus. */
export class BrowserOutlineRows extends Iterator<BrowserLine, undefined> {
	readonly #input: BrowserOutlineRowsInput
	readonly #nodes: ArrayIterator<[number, BrowserOutlineNode]>
	readonly #indexed = new Map<string, BrowserOutlineNode>()
	readonly #omitted = new Set<BrowserOutlineNode>()
	#pending: Iterator<BrowserLine, undefined> = [][Symbol.iterator]()
	#count = 0
	#total = 0
	#focus: string | undefined

	constructor(input: BrowserOutlineRowsInput) {
		super()
		this.#input = input
		this.#nodes = input.nodes.entries()
		for (const node of input.nodes)
			if (!this.#indexed.has(`${node.session}:${node.id}`))
				this.#indexed.set(`${node.session}:${node.id}`, node)
	}

	get listed(): number {
		return this.#count
	}
	get found(): number {
		return this.#total
	}
	get focus(): string | undefined {
		return this.#focus
	}

	next(): IteratorResult<BrowserLine, undefined> {
		while (true) {
			const pending = this.#pending.next()
			if (!pending.done) return pending
			const current = this.#nodes.next()
			if (current.done) return { done: true, value: undefined }
			const [position, node] = current.value
			if (node.ignored) continue
			if (node.reference !== undefined) {
				this.#total += 1
				if (node.properties['focused'] === true) this.#focus = renderBrowserOutlineRow(node)
			}
			if (this.#omitted.has(node)) continue
			const name = normalizeBrowserName(node.name ?? '')
			const parent = this.#indexed.get(`${node.session}:${node.parent}`)
			const spans = this.#render(node, position, name, parent)
			if (spans.length === 0) continue
			const list = this.#input.nodes.find(
				(candidate) =>
					candidate.role === 'listitem' && belongsBrowserOutline(node, candidate, this.#indexed),
			)
			const prefix = list !== undefined && !this.#omitted.has(list) && node.role !== 'heading'
			const final: readonly BrowserLineSpan[] = prefix
				? [{ category: 'syntax', text: '- ' }, ...spans]
				: spans
			if (prefix) this.#omitted.add(list)
			this.#pending = wrapBrowserLine({
				spans: final.map((span) => ({
					...span,
					text: redactBrowserText(span.text, this.#input.secrets),
				})),
			})[Symbol.iterator]()
		}
	}

	#render(
		node: BrowserOutlineNode,
		position: number,
		name: string,
		parent: BrowserOutlineNode | undefined,
	): readonly BrowserLineSpan[] {
		const { nodes, url, limit, secrets } = this.#input
		const indexed = this.#indexed
		const omitted = this.#omitted
		if (node.role === 'heading') {
			const children = nodes.filter((candidate) => belongsBrowserOutline(candidate, node, indexed))
			const references = children.filter((child) => child.reference !== undefined && !child.ignored)
			const folded = references.length === 1 ? references[0] : undefined
			const level = node.properties['level']
			const spans: readonly BrowserLineSpan[] = [
				{
					category: 'syntax',
					text: `${'#'.repeat(isInteger(level) && level > 0 ? Math.min(level, 6) : 1)} `,
				},
			]
			if (
				folded !== undefined &&
				normalizeBrowserName(folded.name ?? '') === name &&
				this.#count < limit
			) {
				const expanded = [...spans, ...renderBrowserSpans(folded, url)]
				this.#count += 1
				for (const child of children) omitted.add(child)
				return expanded
			} else {
				const expanded: readonly BrowserLineSpan[] = [...spans, { category: 'text', text: name }]
				for (const child of children) if (child.role === 'StaticText') omitted.add(child)
				return expanded
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
						if (this.#count >= limit) continue
						joined.push(...renderBrowserSpans(control, url))
						joined.push({ category: 'syntax', text: ' ' })
						this.#count += 1
					}
					if (joined.at(-1)?.text === ' ') joined.pop()
				}
			}
			for (const child of children) omitted.add(child)
			return joined
		} else if (node.role === 'image' || node.role === 'img') {
			if (name !== '')
				return [
					{ category: 'syntax', text: 'image "' },
					{ category: 'text', text: JSON.stringify(name).slice(1, -1) },
					{ category: 'syntax', text: '"' },
				]
		} else if (node.role === 'StaticText') {
			const visited = new Set<string>()
			const owner = new BrowserOutlineAncestors(parent, indexed).find((candidate) => {
				if (candidate.reference !== undefined || visited.has(candidate.id)) return true
				visited.add(candidate.id)
				return false
			})
			if (
				name !== '' &&
				!(owner !== undefined && normalizeBrowserName(owner.name ?? '') !== '') &&
				name !== normalizeBrowserName(parent?.name ?? '') &&
				name !== normalizeBrowserName(String(owner?.value ?? ''))
			) {
				const pieces = [node.name ?? '']
				for (const offset of Array.prototype.keys.call({ length: nodes.length - position - 1 })) {
					const index = position + 1 + offset
					if (parent === undefined) break
					const next = nodes[index]
					if (next?.role === 'InlineTextBox') continue
					if (
						next?.role !== 'StaticText' ||
						next.parent !== node.parent ||
						next.session !== node.session
					)
						break
					pieces.push(next.name ?? '')
					omitted.add(next)
				}
				return [
					{
						category: 'text',
						text: normalizeBrowserName(redactBrowserText(pieces.join(''), secrets)),
					},
				]
			}
		} else if (node.reference !== undefined && this.#count < limit) {
			const spans = renderBrowserSpans(node, url)
			this.#count += 1
			return spans
		}
		return []
	}
}
