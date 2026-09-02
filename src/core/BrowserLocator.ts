import type {
	BrowserActionOptions,
	BrowserActionabilityOptions,
	BrowserFrameInterface,
	BrowserHandleInterface,
	BrowserLocatorClickOptions,
	BrowserLocatorDragOptions,
	BrowserLocatorFilter,
	BrowserLocatorInterface,
	BrowserLocatorTypeOptions,
	BrowserOperationOptions,
	BrowserPointerOptions,
	BrowserPoint,
	BrowserQuery,
	BrowserScreenshotOptions,
	BrowserScreenshotResult,
	BrowserUploadOptions,
	BrowserWaitOptions,
	BrowserWaitState,
} from './types.js'
import { BROWSER_DEFAULT_TIMEOUT_MS, BROWSER_WAIT_POLL_INTERVAL_MS } from './constants.js'
import {
	compileActionabilityFunction,
	compileAttachedLocatorWaitExpression,
	compileDetachedLocatorWaitExpression,
	compileHiddenLocatorWaitExpression,
	compileLocatorExpression,
	compileLocatorListExpression,
	compileScreenshotCleanupExpression,
	compileScreenshotPreparationExpression,
	compileVisibleLocatorWaitExpression,
} from './compilers.js'
import {
	browserScreenshotToParams,
	decodeBase64,
	readBrowserQuad,
	requireBrowserString,
	validateBrowserInputOptions,
} from './helpers.js'
import { BrowserError, BrowserSelectorError } from './errors.js'
import { isArray, isFiniteNumber, isInteger, isRecord, isString } from '@orkestrel/contract'

/**
 * Reusable strict semantic locator over one frame.
 *
 * @example
 * ```ts
 * import { BrowserLocator } from '@orkestrel/browser'
 *
 * const save = new BrowserLocator(page, { selector: 'role', value: 'button', name: 'Save' })
 * await save.click({ count: 2 })
 * const label = await save.text()
 * ```
 */
export class BrowserLocator implements BrowserLocatorInterface {
	readonly #frame: BrowserFrameInterface
	readonly #query: BrowserQuery

	constructor(frame: BrowserFrameInterface, query: BrowserQuery) {
		this.#frame = frame
		this.#query = query
	}

	get frame(): BrowserFrameInterface {
		return this.#frame
	}

	get query(): BrowserQuery {
		return this.#query
	}

	locator(selector: string): BrowserLocatorInterface {
		return new BrowserLocator(this.#frame, {
			selector: 'css',
			value: selector,
			parent: this.#query,
		})
	}

	filter(options: BrowserLocatorFilter): BrowserLocatorInterface {
		return new BrowserLocator(this.#frame, { ...this.#query, filter: options })
	}

	first(): BrowserLocatorInterface {
		return this.item(0)
	}

	last(): BrowserLocatorInterface {
		return this.item(-1)
	}

	item(index: number): BrowserLocatorInterface {
		if (!isInteger(index)) throw new BrowserError('Browser locator index must be an integer')
		return new BrowserLocator(this.#frame, { ...this.#query, index })
	}

	async count(): Promise<number> {
		const value = await this.#frame.evaluate(
			`(${compileLocatorListExpression(this.#query)}).length`,
		)
		if (!isInteger(value) || value < 0) {
			throw new BrowserError('Browser locator count did not resolve to a non-negative integer')
		}
		return value
	}

	async all(): Promise<readonly BrowserLocatorInterface[]> {
		const count = await this.count()
		const locators: BrowserLocatorInterface[] = []
		for (let index = 0; index < count; index += 1) {
			locators.push(this.item(index))
		}
		return locators
	}

	async click(options?: BrowserLocatorClickOptions): Promise<void> {
		const handle = await this.#resolve(options, 'visible')
		try {
			const point = await this.#point(handle, options, {
				visible: true,
				stable: true,
				events: true,
				enabled: true,
			})
			if (options?.trial === true) return
			await this.#frame.mouse.click(point, options)
		} finally {
			await handle.dispose()
		}
	}

	async fill(value: string, options?: BrowserActionOptions): Promise<void> {
		const handle = await this.#resolve(options, 'visible')
		try {
			if (options?.force !== true) {
				await handle.call(
					compileActionabilityFunction({
						visible: true,
						stable: true,
						events: false,
						enabled: true,
						editable: true,
					}),
				)
			}
			if (options?.trial === true) return
			await handle.call(`function() {
				this.focus()
				if (this.isContentEditable) {
					const selection = this.ownerDocument.getSelection()
					const range = this.ownerDocument.createRange()
					range.selectNodeContents(this)
					selection.removeAllRanges()
					selection.addRange(range)
				} else {
					this.select()
				}
			}`)
			await this.#frame.keyboard.insert(value)
		} finally {
			await handle.dispose()
		}
	}

	async select(values: readonly string[], options?: BrowserActionOptions): Promise<void> {
		const handle = await this.#resolve(options, 'visible')
		try {
			if (options?.force !== true) {
				await handle.call(
					compileActionabilityFunction({
						visible: true,
						stable: true,
						events: false,
						enabled: true,
					}),
				)
			}
			if (options?.trial === true) return
			await handle.call(
				`function(values) {
					if (!(this instanceof HTMLSelectElement)) throw new Error('Element is not a select')
					if (!this.multiple && values.length > 1) throw new Error('Single select cannot accept multiple values')
					const available = new Set(Array.from(this.options, (option) => option.value))
					const missing = values.filter((value) => !available.has(value))
					if (missing.length > 0) throw new Error('Select options not found: ' + missing.join(', '))
					for (const option of this.options) option.selected = values.includes(option.value)
					this.dispatchEvent(new Event('input', { bubbles: true }))
					this.dispatchEvent(new Event('change', { bubbles: true }))
				}`,
				[[...values]],
			)
		} finally {
			await handle.dispose()
		}
	}

	async check(options?: BrowserLocatorClickOptions): Promise<void> {
		if ((await this.#boolean('checked')) === true) return
		await this.click(options)
		if ((await this.#boolean('checked')) !== true) {
			throw new BrowserError('Browser locator did not become checked')
		}
	}

	async uncheck(options?: BrowserLocatorClickOptions): Promise<void> {
		if ((await this.#boolean('checked')) === false) return
		await this.click(options)
		if ((await this.#boolean('checked')) !== false) {
			throw new BrowserError('Browser locator did not become unchecked')
		}
	}

	async hover(options?: BrowserPointerOptions): Promise<void> {
		const handle = await this.#resolve(options, 'visible')
		try {
			const point = await this.#point(handle, options, {
				visible: true,
				stable: true,
				events: true,
			})
			if (options?.trial !== true) await this.#frame.mouse.move(point)
		} finally {
			await handle.dispose()
		}
	}

	async focus(options?: BrowserActionOptions): Promise<void> {
		const handle = await this.#resolve(options, 'attached')
		try {
			if (options?.trial !== true) await handle.call('function() { this.focus() }')
		} finally {
			await handle.dispose()
		}
	}

	async press(key: string, options?: BrowserLocatorTypeOptions): Promise<void> {
		await this.focus(options)
		if (options?.trial !== true) await this.#frame.keyboard.press(key, options)
	}

	async type(value: string, options?: BrowserLocatorTypeOptions): Promise<void> {
		await this.focus(options)
		if (options?.trial !== true) await this.#frame.keyboard.type(value, options)
	}

	async clear(options?: BrowserActionOptions): Promise<void> {
		const handle = await this.#resolve(options, 'visible')
		try {
			if (options?.trial === true) return
			await handle.call(`function() {
				this.focus()
				if (this.isContentEditable) {
					this.textContent = ''
				} else if ('value' in this) {
					this.value = ''
				} else {
					throw new Error('Element is not editable')
				}
				this.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
				this.dispatchEvent(new Event('change', { bubbles: true }))
			}`)
		} finally {
			await handle.dispose()
		}
	}

	async wait(options?: BrowserWaitOptions): Promise<void> {
		const timeout = options?.timeout ?? BROWSER_DEFAULT_TIMEOUT_MS
		if (!isFiniteNumber(timeout) || timeout < 0) {
			throw new BrowserError(
				'Browser wait timeout must be a non-negative finite number',
				undefined,
				{
					timeout,
				},
			)
		}
		const state = options?.state ?? 'attached'
		const expression = this.#waitExpression(state, options?.strict ?? true, timeout)
		let found: unknown
		try {
			found = await this.#frame.evaluate(expression, timeout + BROWSER_WAIT_POLL_INTERVAL_MS)
		} catch (error) {
			throw new BrowserSelectorError('Browser locator wait failed', {
				query: this.#query,
				state,
				timeout,
				frame: this.#frame.id,
				error,
			})
		}
		if (found === true) return
		throw new BrowserSelectorError('Timeout waiting for browser locator', {
			query: this.#query,
			state,
			timeout,
			frame: this.#frame.id,
		})
	}

	async text(): Promise<string> {
		const value = await this.#frame.evaluate(
			`(${compileLocatorExpression(this.#query)})?.innerText`,
		)
		return requireBrowserString(value, 'Browser locator text')
	}

	async texts(): Promise<readonly string[]> {
		const value = await this.#frame.evaluate(
			`(${compileLocatorListExpression(this.#query)}).map((element) => element.innerText)`,
		)
		if (!isArray(value) || !value.every(isString)) {
			throw new BrowserError('Browser locator text list is malformed')
		}
		return value
	}

	async html(): Promise<string> {
		return await this.#string('outerHTML', 'Browser locator HTML')
	}

	async value(): Promise<string> {
		const value = await this.#frame.evaluate(
			`(() => { const element = ${compileLocatorExpression(this.#query)}; return element && 'value' in element ? element.value : element?.textContent })()`,
		)
		return requireBrowserString(value, 'Browser locator value')
	}

	async attribute(name: string): Promise<string | undefined> {
		const value = await this.#frame.evaluate(
			`(${compileLocatorExpression(this.#query)})?.getAttribute(${JSON.stringify(name)})`,
		)
		return isString(value) ? value : undefined
	}

	async visible(): Promise<boolean> {
		return await this.#boolean('visible')
	}

	async enabled(): Promise<boolean> {
		return await this.#boolean('enabled')
	}

	async editable(): Promise<boolean> {
		return await this.#boolean('editable')
	}

	async screenshot(options?: BrowserScreenshotOptions): Promise<BrowserScreenshotResult> {
		if (options?.full === true || options?.clip !== undefined) {
			throw new BrowserError('Browser locator screenshot cannot use full-page or custom clip')
		}
		const handle = await this.#resolve(undefined, 'visible')
		let token: string | undefined
		try {
			await handle.call(
				compileActionabilityFunction({
					visible: true,
					stable: true,
					events: false,
					enabled: false,
				}),
			)
			const quad = await this.#quad(handle)
			const xs = [quad.points[0], quad.points[2], quad.points[4], quad.points[6]]
			const ys = [quad.points[1], quad.points[3], quad.points[5], quad.points[7]]
			const x = Math.min(...xs)
			const y = Math.min(...ys)
			const width = Math.max(...xs) - x
			const height = Math.max(...ys) - y
			const params: Record<string, unknown> = {
				...browserScreenshotToParams(options),
				clip: { x, y, width, height, scale: 1 },
				captureBeyondViewport: true,
			}
			if (options?.scale === 'device') {
				const ratio = await this.#frame.evaluate('devicePixelRatio')
				if (!isFiniteNumber(ratio) || ratio <= 0) {
					throw new BrowserError('Browser screenshot device scale is malformed')
				}
				params['clip'] = { x, y, width, height, scale: ratio }
			}
			const preparation = compileScreenshotPreparationExpression(options)
			if (preparation !== undefined) {
				const value = await this.#frame.evaluate(preparation)
				if (!isString(value)) throw new BrowserError('Browser screenshot preparation failed')
				token = value
			}
			if (options?.transparent === true) {
				await this.#frame.send('Emulation.setDefaultBackgroundColorOverride', {
					color: { r: 0, g: 0, b: 0, a: 0 },
				})
			}
			try {
				const result = await this.#frame.send('Page.captureScreenshot', params)
				if (!isRecord(result) || !isString(result['data'])) {
					throw new BrowserError('Locator screenshot failed: no data returned')
				}
				const bytes = decodeBase64(result['data'])
				if (options?.path !== undefined) await this.#frame.save(options.path, bytes)
				return { bytes, path: options?.path }
			} finally {
				if (options?.transparent === true) {
					await this.#frame
						.send('Emulation.setDefaultBackgroundColorOverride')
						.catch(() => undefined)
				}
			}
		} finally {
			if (token !== undefined) {
				await this.#frame.evaluate(compileScreenshotCleanupExpression(token)).catch(() => undefined)
			}
			await handle.dispose()
		}
	}

	async upload(options: BrowserUploadOptions): Promise<void> {
		const handle = await this.#resolve(options, 'attached')
		try {
			if (options.trial === true) return
			await this.#frame.send('DOM.setFileInputFiles', {
				objectId: handle.id,
				files: [...options.files],
			})
		} finally {
			await handle.dispose()
		}
	}

	async drag(target: BrowserLocatorInterface, options?: BrowserLocatorDragOptions): Promise<void> {
		if (target.frame.id !== this.#frame.id) {
			throw new BrowserError('Browser drag target must belong to the same frame')
		}
		const sourceHandle = await this.#resolve(options, 'visible')
		let targetHandle: BrowserHandleInterface | undefined
		try {
			await target.wait({
				...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
				...(options?.strict !== undefined ? { strict: options.strict } : {}),
				state: 'visible',
			})
			targetHandle = await target.frame.handle(compileLocatorExpression(target.query))
			const source = await this.#point(sourceHandle, options, {
				visible: true,
				stable: true,
				events: true,
			})
			const destination = await this.#point(targetHandle, undefined, {
				visible: true,
				stable: true,
				events: true,
			})
			if (options?.trial !== true) {
				await this.#frame.mouse.drag(source, destination, options)
			}
		} finally {
			await sourceHandle.dispose()
			await targetHandle?.dispose()
		}
	}

	async #resolve(
		options: BrowserOperationOptions | undefined,
		state: 'attached' | 'visible',
	): Promise<BrowserHandleInterface> {
		validateBrowserInputOptions(options)
		await this.wait({
			...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
			...(options?.strict !== undefined ? { strict: options.strict } : {}),
			state,
		})
		return await this.#frame.handle(compileLocatorExpression(this.#query))
	}

	async #point(
		handle: BrowserHandleInterface,
		options: BrowserPointerOptions | undefined,
		actionability: BrowserActionabilityOptions,
	): Promise<BrowserPoint> {
		if (options?.force !== true) {
			await handle.call(
				compileActionabilityFunction({
					...actionability,
					...(options?.position !== undefined ? { position: options.position } : {}),
				}),
			)
		}
		const quad = await this.#quad(handle)
		if (options?.position === undefined) return quad.center
		const xs = [quad.points[0], quad.points[2], quad.points[4], quad.points[6]]
		const ys = [quad.points[1], quad.points[3], quad.points[5], quad.points[7]]
		return {
			x: Math.min(...xs) + options.position.x,
			y: Math.min(...ys) + options.position.y,
		}
	}

	async #quad(handle: BrowserHandleInterface): Promise<ReturnType<typeof readBrowserQuad>> {
		return readBrowserQuad(await this.#frame.send('DOM.getContentQuads', { objectId: handle.id }))
	}

	async #string(property: string, field: string): Promise<string> {
		const value = await this.#frame.evaluate(
			`(${compileLocatorExpression(this.#query)})?.[${JSON.stringify(property)}]`,
		)
		return requireBrowserString(value, field)
	}

	async #boolean(property: 'checked' | 'visible' | 'enabled' | 'editable'): Promise<boolean> {
		let expression: string
		switch (property) {
			case 'checked':
				expression = `Boolean((${compileLocatorExpression(this.#query)})?.checked)`
				break
			case 'visible':
				expression = `(() => { const element = ${compileLocatorExpression(this.#query)}; if (!element) return false; const style = getComputedStyle(element); const rect = element.getBoundingClientRect(); return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0 })()`
				break
			case 'enabled':
				expression = `(() => { const element = ${compileLocatorExpression(this.#query)}; return Boolean(element && !element.matches(':disabled')) })()`
				break
			case 'editable':
				expression = `(() => { const element = ${compileLocatorExpression(this.#query)}; return Boolean(element && !element.matches(':disabled,[readonly]') && (element.isContentEditable || 'value' in element)) })()`
				break
		}
		return (await this.#frame.evaluate(expression)) === true
	}

	#waitExpression(state: BrowserWaitState, strict: boolean, timeout: number): string {
		switch (state) {
			case 'attached':
				return compileAttachedLocatorWaitExpression(this.#query, strict, timeout)
			case 'detached':
				return compileDetachedLocatorWaitExpression(this.#query, strict, timeout)
			case 'visible':
				return compileVisibleLocatorWaitExpression(this.#query, strict, timeout)
			case 'hidden':
				return compileHiddenLocatorWaitExpression(this.#query, strict, timeout)
		}
	}
}
