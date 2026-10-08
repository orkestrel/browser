import type {
	BrowserAXNode,
	BrowserCallOptions,
	BrowserElementManagerInput,
	BrowserElementManagerInterface,
	BrowserElementQuery,
	BrowserWaitOptions,
	BrowserOutline,
	BrowserOutlineNode,
	BrowserOutlineOptions,
	BrowserPageElementInterface,
	BrowserPoint,
} from '../types.js'
import { BrowserPageElement } from './BrowserPageElement.js'
import { BrowserError, isBrowserError } from '../errors.js'
import {
	BROWSER_DEFAULT_TIMEOUT_MS,
	BROWSER_CONTEXT_LOSS_PATTERN,
	BROWSER_OUTLINE_LIMIT,
	BROWSER_INTERACTIVE_ROLES,
} from '../constants.js'
import { compileQueryWaitExpression } from '../compilers.js'
import {
	validateBrowserPageOpen,
	composeBrowserPoint,
	filterBrowserOutline,
	readBrowserAccessibility,
	readBrowserQuad,
	readEvaluationResult,
	renderBrowserOutline,
	requireBrowserString,
	validateBrowserTimeout,
	describeBrowserRefusal,
} from '../helpers.js'
import { parseBrowserReference } from '../parsers.js'
import { isArray, isError, isInteger, isRecord, isString } from '@orkestrel/contract'

/**
 * Captures accessibility trees and binds stable references to their owning frame sessions.
 *
 * @remarks
 * A document replacement drops its bindings. A unique link with the same role, accessible name,
 * and resolved href in consecutive documents of this tab keeps its reference when captured again.
 * `input.steps` carries only the steps of each frame's owning session.
 */
export class BrowserElementManager implements BrowserElementManagerInterface<BrowserPageElementInterface> {
	readonly #input: BrowserElementManagerInput
	readonly #records = new Map<
		string,
		{ readonly node: BrowserOutlineNode; readonly element: BrowserPageElement }
	>()
	readonly #owners = new Map<
		string,
		{ readonly frame: string; readonly session: string; readonly backend: number }
	>()
	readonly #lifetime = new AbortController()
	#links = new Map<string, string | undefined>()
	#previous = new Map<string, string | undefined>()
	#sequence = 0
	readonly #generations = new Map<string, number>()
	// Counts every generation step across all frames, so a capture can tell whether any frame it
	// reads navigated while it ran.
	#changes = 0
	readonly #queries = new Map<string, Promise<readonly BrowserOutlineNode[]>>()
	readonly #navigationHandler = this.#navigate.bind(this)
	readonly #commitHandler = this.#commit.bind(this)
	readonly #detachHandler = this.#detach.bind(this)
	readonly #closeHandler = this.#close.bind(this)

	constructor(input: BrowserElementManagerInput) {
		this.#input = input
		input.page.emitter.on('navigate', this.#navigationHandler)
		input.steps.on('commit', this.#commitHandler)
		input.steps.on('detach', this.#detachHandler)
		input.page.emitter.on('close', this.#closeHandler)
	}

	async outline(options?: BrowserOutlineOptions): Promise<BrowserOutline> {
		const limit = options?.limit ?? BROWSER_OUTLINE_LIMIT
		if (!isInteger(limit) || limit < 0)
			throw new BrowserError('ARGUMENT', 'Outline limit must be a nonnegative integer')
		await this.#input.ready(options)
		const epoch = this.#generation(this.#input.page.id)
		const changes = this.#changes
		try {
			const rows = await this.#capture(options)
			const context = await this.#input.world(this.#input.page.id, this.#input.session, options)
			const result = await this.#input.client.send(
				'Runtime.evaluate',
				{ expression: 'document.title', contextId: context, returnByValue: true },
				{ session: this.#input.session, ...options },
			)
			this.#assertCapture(this.#input.page.id, epoch)
			if (this.#changes !== changes)
				throw new BrowserError('ELEMENT', describeBrowserRefusal({ subject: 'outline' }, 'GONE'), {
					subject: 'outline',
					reason: 'GONE',
				})
			return renderBrowserOutline(
				this.#input.page.url,
				requireBrowserString(readEvaluationResult(result), 'Document title'),
				this.#within(rows, options?.within),
				limit,
				options?.secrets,
			)
		} catch (error) {
			// A navigation destroys the contexts, nodes, and sessions the capture was reading, so a
			// rejection that follows one reports the change rather than the protocol failure.
			if (options?.signal?.aborted === true || this.#changes === changes) throw error
			this.#lifetime.signal.throwIfAborted()
			throw new BrowserError('ELEMENT', describeBrowserRefusal({ subject: 'outline' }, 'GONE'), {
				subject: 'outline',
				reason: 'GONE',
			})
		}
	}

	/** A CSS query searches the page's main-frame document; use the accessibility outline for in-process child documents. */
	async find(
		query: BrowserElementQuery,
		options?: BrowserCallOptions,
	): Promise<readonly BrowserPageElementInterface[]> {
		await this.#input.ready(options)
		const epoch = this.#generation(this.#input.page.id)
		const rows = this.#within(await this.#capture(options), query.within)
		let matches = filterBrowserOutline(rows, query)
		if (query.css !== undefined) {
			const session = this.#input.session
			const previous = this.#queries.get(session) ?? Promise.resolve([])
			const pending = previous.catch(() => []).then(this.#css.bind(this, query, epoch, options))
			this.#queries.set(session, pending)
			try {
				const selected = await pending
				const keys = new Set(selected.map((node) => `${node.session}:${node.backend}`))
				if (query.role === undefined && query.name === undefined) matches = selected
				else matches = matches.filter((node) => keys.has(`${node.session}:${node.backend}`))
			} finally {
				if (this.#queries.get(session) === pending) this.#queries.delete(session)
			}
		}
		this.#assertCapture(this.#input.page.id, epoch)
		return matches.flatMap((node) => {
			const entry = this.#records.get(`${node.session}:${node.backend}`)
			return entry === undefined ? [] : [entry.element]
		})
	}

	async #css(
		query: BrowserElementQuery,
		epoch: number,
		options?: BrowserCallOptions,
	): Promise<readonly BrowserOutlineNode[]> {
		const frame = this.#input.page.id
		const session = this.#input.session
		this.#assertCapture(frame, epoch)
		const scope = query.within === undefined ? undefined : this.#record(query.within)
		if (scope !== undefined && scope.node.frame !== frame) return []
		let document = await this.#input.client.send('DOM.getDocument', {}, { session, ...options })
		if (scope !== undefined)
			document = await this.#input.client.send(
				'DOM.pushNodesByBackendIdsToFrontend',
				{ backendNodeIds: [scope.node.backend] },
				{ session, ...options },
			)
		const root =
			isRecord(document) && isRecord(document['root'])
				? document['root']['nodeId']
				: isRecord(document) && isArray(document['nodeIds'])
					? document['nodeIds'][0]
					: undefined
		if (!isInteger(root))
			throw new BrowserError('ELEMENT', describeBrowserRefusal({ subject: 'document' }, 'GONE'), {
				subject: 'document',
				reason: 'GONE',
			})
		const result = await this.#input.client.send(
			'DOM.querySelectorAll',
			{ nodeId: root, selector: query.css },
			{ session, ...options },
		)
		if (!isRecord(result) || !isArray(result['nodeIds']))
			throw new BrowserError('PROTOCOL', 'CSS query result is malformed')
		const rows: BrowserOutlineNode[] = []
		for (const nodeId of result['nodeIds']) {
			if (!isInteger(nodeId)) continue
			const described = await this.#input.client.send(
				'DOM.describeNode',
				{ nodeId },
				{ session, ...options },
			)
			if (
				!isRecord(described) ||
				!isRecord(described['node']) ||
				!isInteger(described['node']['backendNodeId'])
			)
				continue
			const backend = described['node']['backendNodeId']
			this.#assertCapture(frame, epoch)
			const existing = this.#records.get(`${session}:${backend}`)
			if (existing !== undefined) rows.push(existing.node)
			else
				rows.push(
					this.#bind(
						{
							id: `${session}:${backend}`,
							parent: undefined,
							children: [],
							backend,
							frame,
							ignored: false,
							role: 'generic',
							name: '',
							description: undefined,
							value: undefined,
							properties: {},
						},
						frame,
						session,
						true,
					),
				)
		}
		return rows
	}

	async wait(
		query: BrowserElementQuery,
		options?: BrowserWaitOptions,
	): Promise<readonly BrowserPageElementInterface[]> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		validateBrowserTimeout(timeout)
		const end = performance.now() + timeout
		const signal =
			options?.signal === undefined
				? this.#lifetime.signal
				: AbortSignal.any([options.signal, this.#lifetime.signal])
		while (true) {
			signal.throwIfAborted()
			const key = `__browserQueryWait${++this.#sequence}`
			let session: string | undefined
			let context: number | undefined
			const changes = this.#changes
			try {
				await this.#input.ready({ timeout: this.#remaining(end), signal })
				const frame = this.#scopeFrame(query.within)
				session = await this.#input.resolve(frame)
				context = await this.#input.world(frame, session, { timeout: this.#remaining(end), signal })
				const remaining = this.#remaining(end)
				const call = { timeout: remaining, signal }
				// Arm before capturing so mutations during find are retained by the pending promise.
				const pending = this.#input.client
					.send(
						'Runtime.evaluate',
						{
							expression: compileQueryWaitExpression(remaining, key),
							contextId: context,
							returnByValue: true,
							awaitPromise: true,
						},
						{ session, timeout: remaining + 1000, signal },
					)
					.then(
						(result) => ({ result }),
						(error: unknown) => ({ error }),
					)
				const found = await this.find(query, call)
				if (options?.absent === true ? found.length === 0 : found.length > 0) return found
				const outcome = await pending
				if ('error' in outcome) throw outcome.error
				if (readEvaluationResult(outcome.result) !== true || performance.now() >= end)
					throw new BrowserError('TIMEOUT', 'Element wait timed out', { operation: 'wait' })
			} catch (error) {
				signal.throwIfAborted()
				if (isBrowserError(error) && error.code === 'TIMEOUT')
					throw new BrowserError('TIMEOUT', 'Element wait timed out', { operation: 'wait' })
				if (
					this.#input.page.closed ||
					(this.#changes === changes &&
						(!isError(error) || !BROWSER_CONTEXT_LOSS_PATTERN.test(error.message)))
				)
					throw error
				const remaining = this.#remaining(end)
				if (this.#changes === changes) await this.#input.recover({ signal, timeout: remaining })
			} finally {
				if (context !== undefined && session !== undefined)
					await this.#input.client
						.send(
							'Runtime.evaluate',
							{
								expression: `globalThis[${JSON.stringify(key)}]?.()`,
								contextId: context,
								returnByValue: true,
							},
							{ session, timeout: 1000 },
						)
						.catch(() => undefined)
			}
		}
	}

	#remaining(end: number): number {
		const remaining = end - performance.now()
		if (remaining <= 0)
			throw new BrowserError('TIMEOUT', 'Element wait timed out', { operation: 'wait' })
		return remaining
	}

	element(reference: string): BrowserPageElementInterface | undefined {
		const canonical = parseBrowserReference(reference)
		return [...this.#records.values()].find((entry) => entry.node.reference === canonical)?.element
	}

	elements(): readonly BrowserPageElementInterface[] {
		return [...this.#records.values()].map((entry) => entry.element)
	}

	clear(): void {
		this.#changes += 1
		for (const [frame, epoch] of this.#generations) this.#generations.set(frame, epoch + 1)
		this.#records.clear()
		this.#owners.clear()
		this.#previous = new Map()
		this.#links = new Map()
	}

	async #capture(options?: BrowserCallOptions): Promise<readonly BrowserOutlineNode[]> {
		validateBrowserPageOpen(this.#input.page, this.#input.client)
		const changes = this.#changes
		const rows = await this.#tree(this.#input.page.id, this.#input.session, new Set(), options)
		if (changes !== this.#changes)
			throw new BrowserError('ELEMENT', describeBrowserRefusal({ subject: 'outline' }, 'GONE'), {
				subject: 'outline',
				reason: 'GONE',
			})
		const counts = new Map<string, number>()
		const identities = rows.map((row) => {
			const href = row.properties['url']
			if (
				row.role !== 'link' ||
				row.ignored ||
				row.backend === undefined ||
				!isString(href) ||
				!URL.canParse(href)
			)
				return undefined
			const identity = JSON.stringify(['link', row.name, new URL(href).href])
			counts.set(identity, (counts.get(identity) ?? 0) + 1)
			return identity
		})
		const links = new Map<string, string | undefined>()
		const bound = rows.map((row, index) => {
			const identity = identities[index]
			const unique = identity !== undefined && counts.get(identity) === 1
			const node = this.#bind(
				row,
				row.frame ?? this.#input.page.id,
				row.session,
				false,
				unique ? this.#previous.get(identity) : undefined,
			)
			if (identity !== undefined) links.set(identity, unique ? node.reference : undefined)
			return node
		})
		this.#links = links
		this.#previous.clear()
		return bound
	}

	async #tree(
		frame: string,
		session: string,
		visited: Set<string>,
		options?: BrowserCallOptions,
	): Promise<readonly BrowserOutlineNode[]> {
		if (visited.has(frame)) return []
		visited.add(frame)
		const epoch = this.#generation(frame)
		await this.#input.client.send('Accessibility.enable', undefined, { session, ...options })
		this.#assertCapture(frame, epoch)
		const snapshot = readBrowserAccessibility(
			await this.#input.client.send(
				'Accessibility.getFullAXTree',
				{ frameId: frame },
				{ session, ...options },
			),
		)
		this.#assertCapture(frame, epoch)
		const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]))
		const stack = [...snapshot.roots].reverse()
		const seen = new Set<string>()
		const rows: BrowserOutlineNode[] = []
		while (stack.length > 0) {
			this.#assertCapture(frame, epoch)
			options?.signal?.throwIfAborted()
			const id = stack.pop()
			const node = id === undefined ? undefined : nodes.get(id)
			if (node === undefined || seen.has(node.id)) continue
			seen.add(node.id)
			rows.push({ ...node, frame, session, reference: undefined })
			if (node.role === 'Iframe' && node.backend !== undefined) {
				const described = await this.#input.client.send(
					'DOM.describeNode',
					{ backendNodeId: node.backend },
					{ session, ...options },
				)
				const child =
					isRecord(described) && isRecord(described['node'])
						? described['node']['frameId']
						: undefined
				this.#assertCapture(frame, epoch)
				if (isString(child)) {
					this.#owners.set(child, { frame, session, backend: node.backend })
					const childSession = await this.#input.resolve(child)
					rows.push(...(await this.#tree(child, childSession, visited, options)))
				}
			}
			stack.push(...[...node.children].reverse())
		}
		this.#assertCapture(frame, epoch)
		return rows
	}

	#generation(frame: string): number {
		const epoch = this.#generations.get(frame) ?? 0
		this.#generations.set(frame, epoch)
		return epoch
	}

	#assertCapture(frame: string, epoch: number): void {
		this.#lifetime.signal.throwIfAborted()
		if (this.#generation(frame) !== epoch)
			throw new BrowserError('ELEMENT', describeBrowserRefusal({ subject: 'outline' }, 'GONE'), {
				subject: 'outline',
				reason: 'GONE',
			})
	}

	#bind(
		node: BrowserAXNode,
		frame: string,
		session: string,
		css = false,
		carried?: string,
	): BrowserOutlineNode {
		const backend = node.backend
		const tool =
			backend === undefined
				? undefined
				: this.#input.page.registry
						.tools()
						.find((candidate) => candidate.frame === frame && candidate.node === backend)?.name
		if (
			backend === undefined ||
			(!css &&
				(node.ignored || (tool === undefined && !BROWSER_INTERACTIVE_ROLES.has(node.role ?? ''))))
		)
			return { ...node, frame, session, reference: undefined }
		const key = `${session}:${backend}`
		const existing = this.#records.get(key)
		if (existing !== undefined) {
			const row = {
				...node,
				frame,
				session,
				reference: existing.node.reference,
				...(tool === undefined ? {} : { tool }),
			}
			this.#records.set(key, { node: row, element: existing.element })
			return row
		}
		const reference = carried ?? this.#input.reference()
		const row = { ...node, frame, session, reference, ...(tool === undefined ? {} : { tool }) }
		const element = new BrowserPageElement({
			...this.#input,
			description: this.#description.bind(this, key, row),
			node: row,
			backend,
			frame,
			current: this.#current.bind(this, key, reference, frame, this.#generation(frame)),
			point: this.#point.bind(this),
		})
		this.#records.set(key, { node: row, element })
		return row
	}

	#current(key: string, reference: string, frame: string, epoch: number): boolean {
		return this.#generation(frame) === epoch && this.#records.get(key)?.node.reference === reference
	}

	#description(key: string, fallback: BrowserOutlineNode): BrowserOutlineNode {
		const current = this.#records.get(key)?.node
		return current !== undefined && current.reference === fallback.reference ? current : fallback
	}

	#scopeFrame(reference?: string): string {
		if (reference === undefined) return this.#input.page.id
		const scope = this.#record(reference).node
		for (const [frame, owner] of this.#owners) {
			if (owner.session === scope.session && owner.backend === scope.backend) return frame
		}
		return scope.frame ?? this.#input.page.id
	}

	#record(reference: string): {
		readonly node: BrowserOutlineNode
		readonly element: BrowserPageElement
	} {
		const canonical = parseBrowserReference(reference)
		const entry = [...this.#records.values()].find((record) => record.node.reference === canonical)
		if (entry === undefined)
			throw new BrowserError('ELEMENT', describeBrowserRefusal(reference, 'GONE'), {
				reference: reference,
				reason: 'GONE',
			})
		return entry
	}

	#within(rows: readonly BrowserOutlineNode[], reference?: string): readonly BrowserOutlineNode[] {
		if (reference === undefined) return rows
		const scope = this.#record(reference).node
		const key = `${scope.session}:${scope.backend}`
		const included = new Set<string>()
		const frames = new Set<string>()
		return rows.filter((node) => {
			if (
				`${node.session}:${node.backend}` !== key &&
				!included.has(`${node.session}:${node.id}`) &&
				!included.has(`${node.session}:${node.parent}`) &&
				!frames.has(node.frame ?? '')
			)
				return false
			included.add(`${node.session}:${node.id}`)
			for (const [frame, owner] of this.#owners) {
				if (owner.session === node.session && owner.backend === node.backend) frames.add(frame)
			}
			return true
		})
	}

	async #point(
		frame: string,
		point: BrowserPoint,
		options?: BrowserCallOptions,
	): Promise<BrowserPoint> {
		const offsets: BrowserPoint[] = []
		const visited = new Set<string>()
		let current = frame
		while (current !== this.#input.page.id && !visited.has(current)) {
			visited.add(current)
			const owner = this.#owners.get(current)
			if (owner === undefined)
				throw new BrowserError('ELEMENT', describeBrowserRefusal({ subject: 'frame' }, 'GONE'), {
					subject: 'frame',
					reason: 'GONE',
				})
			const session = await this.#input.resolve(current)
			if (session !== owner.session) {
				const result = await this.#input.client.send(
					'DOM.getBoxModel',
					{ backendNodeId: owner.backend },
					{ session: owner.session, ...options },
				)
				const content =
					isRecord(result) && isRecord(result['model']) ? result['model']['content'] : undefined
				const quad = readBrowserQuad({ quads: [content] })
				offsets.push({ x: quad.points[0], y: quad.points[1] })
			}
			current = owner.frame
		}
		return composeBrowserPoint(point, offsets)
	}

	#navigate(_url: string, same: boolean): void {
		if (!same) {
			const previous = this.#links
			this.clear()
			this.#previous = previous
		}
	}

	#commit(frame: string, _url: string, _loader: string | undefined, same: boolean): void {
		if (!same) this.#drop(frame)
	}

	// A swap leaves the frame in another renderer, and its references with the document it left.
	#detach(frame: string): void {
		this.#drop(frame)
	}

	#drop(frame: string): void {
		if (frame === this.#input.page.id) return
		this.#changes += 1
		this.#generations.set(frame, this.#generation(frame) + 1)
		for (const [key, record] of this.#records)
			if (record.node.frame === frame) this.#records.delete(key)
		this.#owners.delete(frame)
	}

	#close(): void {
		this.clear()
		this.#lifetime.abort(new BrowserError('CLOSED', 'Browser session ended'))
		this.#input.page.emitter.off('navigate', this.#navigationHandler)
		this.#input.steps.off('commit', this.#commitHandler)
		this.#input.steps.off('detach', this.#detachHandler)
		this.#input.page.emitter.off('close', this.#closeHandler)
	}
}
