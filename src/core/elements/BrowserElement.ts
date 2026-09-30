import type {
	BrowserCallOptions,
	BrowserElementInput,
	BrowserElementGeometry,
	BrowserPageElementInterface,
	BrowserPoint,
	BrowserQuad,
	BrowserReadingInterface,
	BrowserScreenshotOptions,
	BrowserScreenshotResult,
} from '../types.js'
import { BrowserReading } from '../BrowserReading.js'
import { BrowserElementError } from '../errors.js'
import { BROWSER_RESULT_LIMIT } from '../constants.js'
import {
	compileActionabilityFunction,
	compileGuardedEvaluateExpression,
	compileHitFunction,
	compileReadFunction,
	compileSelectFunction,
} from '../compilers.js'
import {
	computeBrowserButtons,
	computeBrowserModifiers,
	extractBrowserChord,
	keyToBrowserInput,
	normalizeBrowserKey,
	normalizeBrowserName,
	readBrowserQuad,
	readEvaluationResult,
	requireBrowserString,
} from '../helpers.js'
import { isArray, isInteger, isNumber, isRecord, isString } from '@orkestrel/contract'

/**
 * Drives a referenced DOM element through its document's isolated world and the page input stream.
 * @example
 * ```ts
 * const element = page.elements.element('e1')
 * await element?.click()
 * ```
 */
export class BrowserElement implements BrowserPageElementInterface {
	readonly #input: BrowserElementInput

	constructor(input: BrowserElementInput) {
		this.#input = input
	}

	get reference(): string {
		return this.#input.node.reference
	}

	get role(): string {
		return this.#input.description().role ?? 'unknown'
	}

	get name(): string {
		return normalizeBrowserName(this.#input.description().name ?? '')
	}

	async click(options?: BrowserCallOptions): Promise<void> {
		const point = await this.#pointer(options)
		await this.#pair(point, point, options)
	}

	async fill(value: string, options?: BrowserCallOptions): Promise<void> {
		await this.focus(options)
		await this.#call(
			compileActionabilityFunction({ visible: true, enabled: true, editable: true }),
			options,
		)
		await this.#call(compileSelectFunction(), options)
		this.#assert(options)
		await this.#input.page.send('Input.insertText', { text: value }, options)
	}

	async select(values: readonly string[], options?: BrowserCallOptions): Promise<void> {
		await this.#call(compileActionabilityFunction({ visible: true, enabled: true }), options)
		await this.#call(compileSelectFunction(values), options)
	}

	async focus(options?: BrowserCallOptions): Promise<void> {
		this.#assert(options)
		const resolved = await this.#resolve(options)
		try {
			await this.#input.client.send(
				'DOM.focus',
				{ backendNodeId: this.#input.backend },
				{ session: this.#input.node.session, ...options },
			)
		} catch (error) {
			this.#failure(options, error)
		} finally {
			await this.#release(resolved.object)
		}
	}

	async read(options?: BrowserCallOptions): Promise<BrowserReadingInterface> {
		const epoch = this.#epoch()
		const capture = await this.#call(
			`function() {
		const capture = (${compileReadFunction()})()
		capture.html = this.outerHTML
		return ${compileGuardedEvaluateExpression('capture', BROWSER_RESULT_LIMIT)}
	}`,
			options,
		)
		if (!isRecord(capture))
			throw new BrowserElementError(this.reference, 'UNKNOWN', 'returned an invalid reading')
		return new BrowserReading({
			url: requireBrowserString(capture['url'], 'Element URL'),
			title: requireBrowserString(capture['title'], 'Element title'),
			html: requireBrowserString(capture['html'], 'Element HTML'),
			epoch,
			navigation: this.#epoch.bind(this),
		})
	}

	async hover(options?: BrowserCallOptions): Promise<void> {
		const point = await this.#pointer(options)
		await this.#input.page.send(
			'Input.dispatchMouseEvent',
			{ type: 'mouseMoved', ...point, buttons: 0 },
			options,
		)
	}

	async press(value: string, options?: BrowserCallOptions): Promise<void> {
		const chord = extractBrowserChord(normalizeBrowserKey(value))
		const key = keyToBrowserInput(chord.key)
		const modifiers = computeBrowserModifiers(chord.modifiers)
		await this.focus(options)
		this.#assert(options)
		const params = {
			key: key.key,
			code: key.code,
			windowsVirtualKeyCode: key.number,
			nativeVirtualKeyCode: key.number,
			modifiers,
		}
		try {
			await this.#input.page.send(
				'Input.dispatchKeyEvent',
				{
					type: 'keyDown',
					...params,
					text: modifiers === 0 || modifiers === 8 ? key.text : undefined,
				},
				options,
			)
		} finally {
			await this.#input.page.send(
				'Input.dispatchKeyEvent',
				{ type: 'keyUp', ...params },
				options?.timeout === undefined ? undefined : { timeout: options.timeout },
			)
		}
		options?.signal?.throwIfAborted()
	}

	async upload(files: readonly string[], options?: BrowserCallOptions): Promise<void> {
		const resolved = await this.#resolve(options)
		try {
			await this.#input.client.send(
				'DOM.setFileInputFiles',
				{ backendNodeId: this.#input.backend, files },
				{ session: this.#input.node.session, ...options },
			)
		} finally {
			await this.#release(resolved.object)
		}
	}

	async drag(target: BrowserPageElementInterface, options?: BrowserCallOptions): Promise<void> {
		const start = await this.#pointer(options)
		const end = (await target.quad(options)).center
		await this.#pair(start, end, options)
	}

	async quad(options?: BrowserCallOptions): Promise<BrowserQuad> {
		return (await this.#geometry(options)).page
	}

	async #geometry(options?: BrowserCallOptions): Promise<BrowserElementGeometry> {
		this.#assert(options)
		const result = await this.#input.client
			.send(
				'DOM.getContentQuads',
				{ backendNodeId: this.#input.backend },
				{ session: this.#input.node.session, ...options },
			)
			.catch(this.#failure.bind(this, options))
		if (!isRecord(result) || !isArray(result['quads']) || result['quads'].length === 0)
			throw new BrowserElementError(this.reference, 'HIDDEN')
		const quad = readBrowserQuad(result)
		const center = await this.#input.point(this.#input.frame, quad.center, options)
		const x = center.x - quad.center.x
		const y = center.y - quad.center.y
		return {
			local: quad,
			page: {
				points: [
					quad.points[0] + x,
					quad.points[1] + y,
					quad.points[2] + x,
					quad.points[3] + y,
					quad.points[4] + x,
					quad.points[5] + y,
					quad.points[6] + x,
					quad.points[7] + y,
				],
				center,
			},
		}
	}

	async screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult> {
		const quad = await this.quad()
		const scroll = await this.#scroll(this.#input.session)
		const xs = quad.points.filter((_value, index) => index % 2 === 0)
		const ys = quad.points.filter((_value, index) => index % 2 !== 0)
		const x = Math.min(...xs)
		const y = Math.min(...ys)
		return await this.#input.page.screenshot({
			...options,
			full: false,
			clip: [x + scroll.x, y + scroll.y, Math.max(...xs) - x, Math.max(...ys) - y],
		})
	}

	#assert(options?: BrowserCallOptions): void {
		options?.signal?.throwIfAborted()
		if (!this.#input.current())
			throw new BrowserElementError(this.reference, 'GONE', 'is gone because the page changed')
		this.#input.page.assert()
	}

	#epoch(): number {
		return this.#input.navigation(this.#input.frame)
	}

	async #resolve(
		options?: BrowserCallOptions,
		backend = this.#input.backend,
	): Promise<{ readonly object: string; readonly context: number }> {
		this.#assert(options)
		const context = await this.#input.world(this.#input.frame, this.#input.node.session, options)
		try {
			const result = await this.#input.client.send(
				'DOM.resolveNode',
				{ backendNodeId: backend, executionContextId: context },
				{ session: this.#input.node.session, ...options },
			)
			if (
				!isRecord(result) ||
				!isRecord(result['object']) ||
				!isString(result['object']['objectId'])
			)
				throw new BrowserElementError(this.reference, 'GONE')
			this.#assert(options)
			return { object: result['object']['objectId'], context }
		} catch {
			options?.signal?.throwIfAborted()
			throw new BrowserElementError(this.reference, 'GONE')
		}
	}

	async #call(
		declaration: string,
		options?: BrowserCallOptions,
		target?: number,
	): Promise<unknown> {
		const resolved = await this.#resolve(options)
		let hit: { readonly object: string; readonly context: number } | undefined
		try {
			if (target !== undefined) hit = await this.#resolve(options, target)
			const result = await this.#input.client.send(
				'Runtime.callFunctionOn',
				{
					functionDeclaration: `function(element, target) { return (${declaration}).call(element, target) }`,
					executionContextId: resolved.context,
					arguments: [
						{ objectId: resolved.object },
						...(hit === undefined ? [] : [{ objectId: hit.object }]),
					],
					returnByValue: true,
					awaitPromise: true,
				},
				{ session: this.#input.node.session, ...options },
			)
			this.#assert(options)
			return readEvaluationResult(result)
		} catch (error) {
			this.#failure(options, error)
		} finally {
			await this.#release(resolved.object)
			if (hit !== undefined) await this.#release(hit.object)
		}
	}

	#failure(options: BrowserCallOptions | undefined, error: unknown): never {
		options?.signal?.throwIfAborted()
		if (error instanceof BrowserElementError) throw error
		const message = error instanceof Error ? error.message : String(error)
		const reason = /layout object|not visible/i.test(message)
			? 'HIDDEN'
			: /disabled/i.test(message)
				? 'DISABLED'
				: /detached|Could not find node|No node with given id|not found|context/i.test(message)
					? 'GONE'
					: undefined
		if (reason === undefined) throw error
		throw new BrowserElementError(this.reference, reason, reason === 'GONE' ? undefined : message)
	}

	async #scroll(session: string, options?: BrowserCallOptions): Promise<BrowserPoint> {
		const result = await this.#input.client.send(
			'Page.getLayoutMetrics',
			{},
			{ session, ...options },
		)
		const viewport = isRecord(result)
			? (result['cssLayoutViewport'] ?? result['cssVisualViewport'])
			: undefined
		return {
			x: isRecord(viewport) && isNumber(viewport['pageX']) ? viewport['pageX'] : 0,
			y: isRecord(viewport) && isNumber(viewport['pageY']) ? viewport['pageY'] : 0,
		}
	}

	async #release(object: string): Promise<void> {
		await this.#input.client
			.send(
				'Runtime.releaseObject',
				{ objectId: object },
				{ session: this.#input.node.session, timeout: 1000 },
			)
			.catch(() => undefined)
	}

	async #pointer(options?: BrowserCallOptions): Promise<BrowserPoint> {
		this.#assert(options)
		await this.#input.client
			.send(
				'DOM.scrollIntoViewIfNeeded',
				{ backendNodeId: this.#input.backend },
				{ session: this.#input.node.session, ...options },
			)
			.catch(this.#failure.bind(this, options))
		await this.#call(
			compileActionabilityFunction({ visible: true, enabled: true, stable: true }),
			options,
		)
		const geometry = await this.#geometry(options)
		const point = geometry.page.center
		const local = geometry.local.center
		const scroll = await this.#scroll(this.#input.node.session, options)
		const hit = await this.#input.client.send(
			'DOM.getNodeForLocation',
			{ x: Math.round(local.x + scroll.x), y: Math.round(local.y + scroll.y) },
			{ session: this.#input.node.session, ...options },
		)
		if (
			!isRecord(hit) ||
			!isInteger(hit['backendNodeId']) ||
			(hit['frameId'] !== undefined && hit['frameId'] !== this.#input.frame)
		)
			throw new BrowserElementError(this.reference, 'OCCLUDED')
		if (
			hit['backendNodeId'] !== this.#input.backend &&
			(await this.#call(compileHitFunction(), options, hit['backendNodeId'])) !== true
		) {
			const described = await this.#input.client.send(
				'DOM.describeNode',
				{ backendNodeId: hit['backendNodeId'] },
				{ session: this.#input.node.session, ...options },
			)
			const node =
				isRecord(described) && isRecord(described['node']) ? described['node'] : undefined
			let name = isString(node?.['nodeName']) ? node['nodeName'].toLowerCase() : 'element'
			const attributes = node?.['attributes']
			if (isArray(attributes)) {
				const id = attributes[attributes.indexOf('id') + 1]
				const classes = attributes[attributes.indexOf('class') + 1]
				if (attributes.includes('id') && isString(id) && id !== '') name += `#${id}`
				else if (attributes.includes('class') && isString(classes) && classes.trim() !== '')
					name += `.${classes.trim().split(/\s+/).join('.')}`
			}
			throw new BrowserElementError(this.reference, 'OCCLUDED', `is covered by ${name}`)
		}
		return point
	}

	async #pair(start: BrowserPoint, end: BrowserPoint, options?: BrowserCallOptions): Promise<void> {
		this.#assert(options)
		try {
			await this.#input.page.send(
				'Input.dispatchMouseEvent',
				{
					type: 'mousePressed',
					...start,
					button: 'left',
					buttons: computeBrowserButtons(['left']),
					clickCount: 1,
				},
				options,
			)
			if (start.x !== end.x || start.y !== end.y)
				await this.#input.page.send(
					'Input.dispatchMouseEvent',
					{ type: 'mouseMoved', ...end, button: 'left', buttons: computeBrowserButtons(['left']) },
					options,
				)
		} finally {
			await this.#input.page.send(
				'Input.dispatchMouseEvent',
				{ type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1 },
				options?.timeout === undefined ? undefined : { timeout: options.timeout },
			)
		}
		options?.signal?.throwIfAborted()
	}
}
