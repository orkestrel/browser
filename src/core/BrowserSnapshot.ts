import type {
	BrowserDocument,
	BrowserNode,
	BrowserNodePredicate,
	BrowserNodeQuery,
	BrowserSiblingRelation,
	BrowserSnapshotInput,
	BrowserSnapshotInterface,
	BrowserWalkOptions,
} from './types.js'
import { isFunction, isInteger } from '@orkestrel/contract'
import { BrowserError } from './errors.js'
import { matchesBrowserNode } from './helpers.js'

/** A navigable, serializable browser DOM snapshot. */
export class BrowserSnapshot implements BrowserSnapshotInterface {
	readonly documents: readonly BrowserDocument[]
	readonly styles: readonly string[]

	constructor(input: BrowserSnapshotInput) {
		this.documents = Object.freeze([...input.documents])
		this.styles = Object.freeze([...input.styles])
	}

	walk(options?: BrowserWalkOptions): Generator<BrowserNode, void, unknown> {
		return options?.order === 'breadth' ? this.#breadth(options.root) : this.#depth(options?.root)
	}

	*descendants(node: BrowserNode): Generator<BrowserNode, void, unknown> {
		let first = true
		for (const descendant of this.#depth(node)) {
			if (first) {
				first = false
				continue
			}
			yield descendant
		}
	}

	document(node: BrowserNode): BrowserDocument | undefined {
		return this.documents.find((document) => document.index === node.document)
	}

	children(node: BrowserNode): readonly BrowserNode[] {
		const document = this.document(node)
		if (document === undefined) return []
		const children = document.nodes.filter((candidate) => candidate.parent === node.index)
		if (node.content === undefined) return children
		const content = this.documents.find((candidate) => candidate.index === node.content)
		if (content === undefined) return children
		return [...children, ...content.nodes.filter((candidate) => candidate.parent === undefined)]
	}

	parent(node: BrowserNode): BrowserNode | undefined {
		const document = this.document(node)
		if (document === undefined) return undefined
		return node.parent === undefined
			? this.find((candidate) => candidate.content === node.document)
			: document.nodes[node.parent]
	}

	siblings(node: BrowserNode, relation?: BrowserSiblingRelation): readonly BrowserNode[] {
		const candidates = this.#candidates(node)
		const index = candidates.findIndex(
			(candidate) => candidate.document === node.document && candidate.index === node.index,
		)
		if (relation === 'preceding') return index < 0 ? [] : candidates.slice(0, index)
		if (relation === 'following') return index < 0 ? [] : candidates.slice(index + 1)
		return candidates.filter(
			(candidate) => candidate.document !== node.document || candidate.index !== node.index,
		)
	}

	ancestors(node: BrowserNode): readonly BrowserNode[] {
		const ancestors: BrowserNode[] = []
		const visited = new Set<string>()
		let current = node

		while (true) {
			const parent = this.parent(current)
			if (parent === undefined) break
			const identity = this.#identity(parent)
			if (visited.has(identity)) break
			visited.add(identity)
			ancestors.push(parent)
			current = parent
		}
		return ancestors
	}

	common(first: BrowserNode, second: BrowserNode): BrowserNode | undefined {
		const firstAncestors = [first, ...this.ancestors(first)]
		const secondAncestors = [second, ...this.ancestors(second)]
		const identities = new Set(firstAncestors.map((node) => this.#identity(node)))
		return secondAncestors.find((node) => identities.has(this.#identity(node)))
	}

	distance(first: BrowserNode, second: BrowserNode): number | undefined {
		const common = this.common(first, second)
		if (common === undefined) return undefined
		const identity = this.#identity(common)
		const firstDistance = [first, ...this.ancestors(first)].findIndex(
			(node) => this.#identity(node) === identity,
		)
		const secondDistance = [second, ...this.ancestors(second)].findIndex(
			(node) => this.#identity(node) === identity,
		)
		if (firstDistance < 0 || secondDistance < 0) return undefined
		return firstDistance + secondDistance
	}

	find(query: BrowserNodeQuery | BrowserNodePredicate): BrowserNode | undefined {
		for (const node of this.walk()) {
			if (this.#match(node, query)) return node
		}
		return undefined
	}

	filter(query: BrowserNodeQuery | BrowserNodePredicate, limit?: number): readonly BrowserNode[] {
		if (limit !== undefined && (!isInteger(limit) || limit < 0)) {
			throw new BrowserError(
				'Browser node result limit must be a non-negative integer',
				undefined,
				{
					limit,
				},
			)
		}
		if (limit === 0) return []
		const found: BrowserNode[] = []
		for (const node of this.walk()) {
			if (!this.#match(node, query)) continue
			found.push(node)
			if (limit !== undefined && found.length >= limit) break
		}
		return found
	}

	closest(
		node: BrowserNode,
		query: BrowserNodeQuery | BrowserNodePredicate,
	): BrowserNode | undefined {
		if (this.#match(node, query)) return node
		for (const ancestor of this.ancestors(node)) {
			if (this.#match(ancestor, query)) return ancestor
		}
		return undefined
	}

	path(node: BrowserNode): string {
		const document = this.document(node)
		if (document === undefined) return `document:${node.document} > node:${node.index}`
		const chain = [...this.ancestors(node)].reverse()
		chain.push(node)
		const segments: string[] = []

		for (const current of chain) {
			if (current.type !== 1) {
				segments.push(`${current.name.toLowerCase()}:${current.index}`)
				continue
			}
			let ordinal = 1
			if (current.parent !== undefined) {
				const owner = this.document(current)
				for (const sibling of owner?.nodes ?? []) {
					if (sibling.index >= current.index) break
					if (sibling.parent === current.parent && sibling.name === current.name) ordinal += 1
				}
			}
			segments.push(`${current.name.toLowerCase()}:${ordinal}`)
		}

		return `frame(${JSON.stringify(document.frame)}) > ${segments.join(' > ')}`
	}

	#roots(): readonly BrowserNode[] {
		const roots: BrowserNode[] = []
		for (const document of this.documents) {
			roots.push(...document.nodes.filter((node) => node.parent === undefined))
		}
		for (const document of this.documents) roots.push(...document.nodes)
		return roots
	}

	*#depth(root?: BrowserNode): Generator<BrowserNode, void, unknown> {
		const visited = new Set<string>()
		for (const seed of root === undefined ? this.#roots() : [root]) {
			const stack: BrowserNode[] = [seed]
			while (stack.length > 0) {
				const node = stack.pop()
				if (node === undefined) break
				const identity = this.#identity(node)
				if (visited.has(identity)) continue
				visited.add(identity)
				yield node

				const children = this.children(node)
				for (let index = children.length - 1; index >= 0; index -= 1) {
					const child = children[index]
					if (child !== undefined) stack.push(child)
				}
			}
		}
	}

	*#breadth(root?: BrowserNode): Generator<BrowserNode, void, unknown> {
		const visited = new Set<string>()
		for (const seed of root === undefined ? this.#roots() : [root]) {
			const queue: BrowserNode[] = [seed]
			let cursor = 0
			while (cursor < queue.length) {
				const node = queue[cursor]
				cursor += 1
				if (node === undefined) continue
				const identity = this.#identity(node)
				if (visited.has(identity)) continue
				visited.add(identity)
				yield node
				queue.push(...this.children(node))
			}
		}
	}

	#candidates(node: BrowserNode): readonly BrowserNode[] {
		const parent = this.parent(node)
		return parent === undefined
			? (this.document(node)?.nodes.filter((candidate) => candidate.parent === undefined) ?? [])
			: this.children(parent)
	}

	#match(node: BrowserNode, query: BrowserNodeQuery | BrowserNodePredicate): boolean {
		if (isFunction(query)) return Boolean(query(node))
		return Reflect.apply(matchesBrowserNode, undefined, [node, query])
	}

	#identity(node: BrowserNode): string {
		return `${node.document}:${node.index}`
	}
}
