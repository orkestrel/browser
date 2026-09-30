import type {
	BrowserAXNode,
	BrowserCallOptions,
	BrowserElementManagerInput,
	BrowserElementManagerInterface,
	BrowserElementQuery,
	BrowserElementWaitOptions,
	BrowserFrameInterface,
	BrowserOutline,
	BrowserOutlineNode,
	BrowserOutlineOptions,
	BrowserPageElementInterface,
	BrowserPoint,
	CDPHandler,
} from '../types.js'
import { BrowserElement } from './BrowserElement.js'
import { BrowserElementError, BrowserError } from '../errors.js'
import {
	BROWSER_DEFAULT_TIMEOUT_MS,
	BROWSER_OUTLINE_LIMIT,
	BROWSER_INTERACTIVE_ROLES,
} from '../constants.js'
import { compileQueryWaitExpression } from '../compilers.js'
import {
	composeBrowserPoint,
	filterBrowserOutline,
	readBrowserAccessibility,
	readBrowserQuad,
	readEvaluationResult,
	renderBrowserOutline,
	requireBrowserString,
	validateBrowserTimeout,
} from '../helpers.js'
import { parseBrowserReference } from '../parsers.js'
import { isArray, isInteger, isRecord, isString } from '@orkestrel/contract'

/**
 * Captures accessibility trees and binds stable references to their owning frame sessions.
 * @example
 * ```ts
 * const outline = await page.elements.outline()
 * const matches = await page.elements.find({ role: 'button', name: 'save' })
 * await matches[0]?.click()
 * ```
 */
export class BrowserElementManager implements BrowserElementManagerInterface<BrowserPageElementInterface> {
	readonly #input: BrowserElementManagerInput
	readonly #records = new Map<
		string,
		{ readonly node: BrowserOutlineNode; readonly element: BrowserElement }
	>()
	readonly #owners = new Map<
		string,
		{ readonly frame: string; readonly session: string; readonly backend: number }
	>()
	// Each watched session, the out-of-process frame it owns (none for the page session), and the
	// invalidation handlers bound to it.
	readonly #sessions = new Map<
		string,
		{
			readonly frame: string | undefined
			readonly navigated: CDPHandler
			readonly detached: CDPHandler
		}
	>()
	readonly #lifetime = new AbortController()
	#sequence = 0
	readonly #generations = new Map<string, number>()
	readonly #queries = new Map<string, Promise<readonly BrowserOutlineNode[]>>()
	readonly #navigationHandler = this.#navigate.bind(this)
	readonly #sessionHandler = this.#session.bind(this)
	readonly #closeHandler = this.#close.bind(this)

	constructor(input: BrowserElementManagerInput) {
		this.#input = input
		this.#watch(input.session, undefined)
		input.page.emitter.on('navigate', this.#navigationHandler)
		input.page.emitter.on('session', this.#sessionHandler)
		input.page.emitter.on('close', this.#closeHandler)
	}

	async outline(options?: BrowserOutlineOptions): Promise<BrowserOutline> {
		const limit = options?.limit ?? BROWSER_OUTLINE_LIMIT
		if (!isInteger(limit) || limit < 0)
			throw new BrowserError('Outline limit must be a nonnegative integer')
		await this.#input.ready(options)
		const epoch = this.#generation(this.#input.page.id)
		const rows = await this.#capture(options)
		const context = await this.#input.world(this.#input.page.id, this.#input.session, options)
		const result = await this.#input.client.send(
			'Runtime.evaluate',
			{ expression: 'document.title', contextId: context, returnByValue: true },
			{ session: this.#input.session, ...options },
		)
		this.#assertCapture(this.#input.page.id, epoch)
		return renderBrowserOutline(
			this.#input.page.url,
			requireBrowserString(readEvaluationResult(result), 'Document title'),
			this.#within(rows, options?.within),
			limit,
		)
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
		if (!isInteger(root)) throw new BrowserElementError({ subject: 'document' }, 'GONE')
		const result = await this.#input.client.send(
			'DOM.querySelectorAll',
			{ nodeId: root, selector: query.css },
			{ session, ...options },
		)
		if (!isRecord(result) || !isArray(result['nodeIds']))
			throw new BrowserError('CSS query result is malformed')
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
		options?: BrowserElementWaitOptions,
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
			const remaining = Math.max(0, end - performance.now())
			const call = { timeout: remaining, signal }
			await this.#input.ready(call)
			const frame = this.#scopeFrame(query.within)
			const session = await this.#input.resolve(frame)
			const context = await this.#input.world(frame, session, call)
			const key = `__browserQueryWait${++this.#sequence}`
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
			try {
				const found = await this.find(query, call)
				if (options?.absent === true ? found.length === 0 : found.length > 0) return found
				const outcome = await pending
				if ('error' in outcome) throw outcome.error
				if (readEvaluationResult(outcome.result) !== true || performance.now() >= end)
					throw new BrowserError('Element wait timed out', 'BROWSER_WAIT_TIMEOUT')
			} finally {
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

	element(reference: string): BrowserPageElementInterface | undefined {
		const canonical = parseBrowserReference(reference)
		return [...this.#records.values()].find((entry) => entry.node.reference === canonical)?.element
	}

	elements(): readonly BrowserPageElementInterface[] {
		return [...this.#records.values()].map((entry) => entry.element)
	}

	clear(): void {
		for (const [frame, epoch] of this.#generations) this.#generations.set(frame, epoch + 1)
		this.#records.clear()
		this.#owners.clear()
	}

	async #capture(options?: BrowserCallOptions): Promise<readonly BrowserOutlineNode[]> {
		this.#input.page.assert()
		const rows = await this.#tree(this.#input.page.id, this.#input.session, new Set(), options)
		return rows
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
			rows.push(this.#bind(node, frame, session))
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
			throw new BrowserElementError({ subject: 'outline' }, 'GONE')
	}

	#bind(node: BrowserAXNode, frame: string, session: string, css = false): BrowserOutlineNode {
		const backend = node.backend
		if (
			backend === undefined ||
			(!css && (node.ignored || !BROWSER_INTERACTIVE_ROLES.has(node.role ?? '')))
		)
			return { ...node, frame, session, reference: undefined }
		const key = `${session}:${backend}`
		const existing = this.#records.get(key)
		if (existing !== undefined) {
			const row = { ...node, frame, session, reference: existing.node.reference }
			this.#records.set(key, { node: row, element: existing.element })
			return row
		}
		const reference = this.#input.reference()
		const row = { ...node, frame, session, reference }
		const element = new BrowserElement({
			...this.#input,
			description: this.#description.bind(this, key, row),
			node: row,
			backend,
			frame,
			current: this.#current.bind(this, key, reference),
			point: this.#point.bind(this),
		})
		this.#records.set(key, { node: row, element })
		return row
	}

	#current(key: string, reference: string): boolean {
		return this.#records.get(key)?.node.reference === reference
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
		readonly element: BrowserElement
	} {
		const canonical = parseBrowserReference(reference)
		const entry = [...this.#records.values()].find((record) => record.node.reference === canonical)
		if (entry === undefined) throw new BrowserElementError(reference, 'GONE')
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
			if (owner === undefined) throw new BrowserElementError({ subject: 'frame' }, 'GONE')
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
		if (!same) this.clear()
	}

	#frameChanged(session: string, params: Readonly<Record<string, unknown>>): void {
		if (!isRecord(params['frame']) || !isString(params['frame']['id'])) return
		if (this.#owns(session, params['frame']['id'])) this.#drop(params['frame']['id'])
	}

	#detached(session: string, params: Readonly<Record<string, unknown>>): void {
		if (isString(params['frameId']) && this.#owns(session, params['frameId']))
			this.#drop(params['frameId'])
	}

	// The page session reports on every frame, including a swap of an out-of-process one; a frame
	// session reports only on a frame no other session owns.
	#owns(session: string, frame: string): boolean {
		if (session === this.#input.session) return true
		for (const [other, watched] of this.#sessions)
			if (watched.frame === frame) return other === session
		return true
	}

	#drop(frame: string): void {
		if (frame === this.#input.page.id) return
		this.#generations.set(frame, this.#generation(frame) + 1)
		for (const [key, record] of this.#records)
			if (record.node.frame === frame) this.#records.delete(key)
		this.#owners.delete(frame)
	}

	#session(frame: BrowserFrameInterface): void {
		void this.#input
			.resolve(frame.id)
			.then(this.#own.bind(this, frame.id))
			.catch(() => undefined)
	}

	// The page publishes a frame's owning session, so a session that owned the frame before stops
	// reporting on it here.
	#own(frame: string, session: string): void {
		for (const [other, watched] of this.#sessions)
			if (watched.frame === frame && other !== session) this.#unwatch(other)
		this.#watch(session, frame)
	}

	#watch(session: string, frame: string | undefined): void {
		if (this.#sessions.has(session) || this.#lifetime.signal.aborted) return
		const watched = {
			frame,
			navigated: this.#frameChanged.bind(this, session),
			detached: this.#detached.bind(this, session),
		}
		this.#sessions.set(session, watched)
		this.#input.client.subscribe('Page.frameNavigated', watched.navigated, session)
		this.#input.client.subscribe('Page.frameDetached', watched.detached, session)
	}

	#unwatch(session: string): void {
		const watched = this.#sessions.get(session)
		if (watched === undefined) return
		this.#input.client.unsubscribe('Page.frameNavigated', watched.navigated, session)
		this.#input.client.unsubscribe('Page.frameDetached', watched.detached, session)
		this.#sessions.delete(session)
	}

	#close(): void {
		this.clear()
		this.#lifetime.abort(new BrowserError('Browser session ended'))
		for (const session of this.#sessions.keys()) this.#unwatch(session)
		this.#input.page.emitter.off('navigate', this.#navigationHandler)
		this.#input.page.emitter.off('session', this.#sessionHandler)
		this.#input.page.emitter.off('close', this.#closeHandler)
	}
}
