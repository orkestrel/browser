import type {
	BrowserCodegenGesture,
	BrowserCodegenInterface,
	BrowserCodegenLanguage,
	BrowserCodegenScript,
	BrowserJourney,
	BrowserJourneyStep,
	BrowserJourneyStepInput,
	BrowserJourneyTarget,
	BrowserRecorderEventMap,
	BrowserRecorderOptions,
	CDPClientInterface,
	CDPHandler,
} from '../types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { isArray, isInteger, isRecord, isString } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'
import { BrowserTransition } from '../BrowserTransition.js'
import {
	BROWSER_CODEGEN_BINDING_NAME,
	BROWSER_CODEGEN_SOURCE,
	BROWSER_INTERACTIVE_ROLES,
} from '../constants.js'
import { compileBrowserJourney } from '../compilers.js'
import { BrowserError } from '../errors.js'
import {
	buildBrowserJourney,
	collectBrowserJourneySecrets,
	deriveBrowserJourneySecret,
	readBrowserAXValue,
	readBrowserFrames,
} from '../helpers.js'
import { parseCodegenActionPayload } from '../parsers.js'

/**
 * Records semantic page gestures and compiles them into a journey module.
 * @example
 * const recorder = await page.codegen()
 * await recorder.stop()
 * const script = recorder.script({ name: "add-note", description: "Add a note" })
 */
export class BrowserCodegen implements BrowserCodegenInterface {
	readonly #client: CDPClientInterface
	readonly #session: string
	readonly #frames: (() => readonly string[]) | undefined
	readonly #emitter: Emitter<BrowserRecorderEventMap>
	readonly #starting = new BrowserTransition()
	readonly #stopping = new BrowserTransition<readonly BrowserJourneyStep[]>()
	readonly #sessions = new Map<
		string,
		{
			readonly handlers: ReadonlyArray<readonly [string, CDPHandler]>
			readonly contexts: Set<number>
			readonly attempt: Promise<void>
		}
	>()
	readonly #scripts = new Map<string, string>()
	#started = false
	#shutdown: Promise<void> | undefined
	#queue: Promise<void> = Promise.resolve()
	#steps: readonly BrowserJourneyStep[] = []
	#pending: { readonly key: string; readonly step: BrowserJourneyStepInput } | undefined
	#enter: string | undefined
	#epoch = 0
	#frame: string | undefined

	constructor(
		client: CDPClientInterface,
		session: string,
		options?: BrowserRecorderOptions,
		frames?: () => readonly string[],
	) {
		this.#client = client
		this.#session = session
		this.#frames = frames
		this.#emitter = new Emitter({
			...(options?.on === undefined ? {} : { on: options.on }),
			...(options?.error === undefined ? {} : { error: options.error }),
		})
	}
	get emitter(): EmitterInterface<BrowserRecorderEventMap> {
		return this.#emitter
	}
	get started(): boolean {
		return this.#started
	}

	async start(): Promise<void> {
		if (this.#shutdown !== undefined || this.#emitter.destroyed)
			throw new BrowserError('The recorder was destroyed')
		await this.#stopping.pending
		if (this.#starting.pending !== undefined) return await this.#starting.pending
		if (this.#started) return
		await this.#starting.execute(async () => {
			this.clear()
			try {
				await this.#install(this.#session)
				await Promise.all((this.#frames?.() ?? []).map((session) => this.#install(session)))
				this.#started = true
				this.#emitter.emit('start')
			} catch (error) {
				await this.#remove()
				throw error
			}
		})
	}
	/**
	 * Installs recording on an attached frame before its owner resumes it.
	 * @param session - The attached frame session
	 * @returns Completion of listener installation
	 */
	async attach(session: string): Promise<void> {
		if (
			(!this.#started && this.#starting.pending === undefined) ||
			this.#stopping.pending !== undefined ||
			this.#shutdown !== undefined
		)
			return
		await this.#install(session)
	}
	async stop(): Promise<readonly BrowserJourneyStep[]> {
		await this.#starting.pending?.catch(() => undefined)
		if (this.#stopping.pending !== undefined) return await this.#stopping.pending
		if (!this.#started) return this.steps()
		return await this.#stopping.execute(async () => {
			await this.#remove()
			await this.#queue
			this.#flush()
			this.#enter = undefined
			this.#started = false
			const steps = this.steps()
			this.#emitter.emit('stop', structuredClone(steps))
			return steps
		})
	}
	steps(): readonly BrowserJourneyStep[] {
		return structuredClone(this.#steps)
	}
	journey(options: { readonly name: string; readonly description: string }): BrowserJourney {
		return buildBrowserJourney(this.#steps, options)
	}
	script(options: {
		readonly name: string
		readonly description: string
		readonly language?: BrowserCodegenLanguage
	}): BrowserCodegenScript {
		return compileBrowserJourney(
			this.journey({ name: options.name, description: options.description }),
			options.language === undefined ? {} : { language: options.language },
		)
	}
	clear(): void {
		this.#epoch += 1
		this.#steps = []
		this.#pending = undefined
		this.#enter = undefined
		this.#emitter.emit('clear')
	}
	async destroy(): Promise<void> {
		if (this.#shutdown !== undefined) return await this.#shutdown
		this.#shutdown = this.#destroy()
		await this.#shutdown
	}
	async #destroy(): Promise<void> {
		await this.stop()
		this.clear()
		this.#emitter.destroy()
	}
	async #install(session: string): Promise<void> {
		const active = this.#sessions.get(session)
		if (active !== undefined) return await active.attempt
		const handlers: ReadonlyArray<readonly [string, CDPHandler]> = [
			['Runtime.bindingCalled', this.#binding.bind(this, session)],
			['Page.frameNavigated', this.#navigation.bind(this, session)],
			['Page.navigatedWithinDocument', this.#navigation.bind(this, session)],
			['Page.javascriptDialogClosed', this.#dialog.bind(this)],
		]
		for (const [method, handler] of handlers) this.#client.subscribe(method, handler, session)
		const attempt = this.#inject(session)
		this.#sessions.set(session, { handlers, contexts: new Set(), attempt })
		await attempt
	}
	async #inject(session: string): Promise<void> {
		await this.#client.send('Page.enable', undefined, { session })
		if (session === this.#session) {
			const tree = await this.#client.send('Page.getFrameTree', undefined, { session })
			this.#frame = readBrowserFrames(tree).find((frame) => frame.parent === undefined)?.id
			if (this.#frame === undefined) throw new BrowserError('The recorder requires a main frame')
		}
		await this.#client.send('Runtime.enable', undefined, { session })
		await this.#client.send(
			'Runtime.addBinding',
			{ name: BROWSER_CODEGEN_BINDING_NAME },
			{ session },
		)
		const result = await this.#client.send(
			'Page.addScriptToEvaluateOnNewDocument',
			{ source: BROWSER_CODEGEN_SOURCE, runImmediately: true },
			{ session },
		)
		if (isRecord(result) && isString(result['identifier']))
			this.#scripts.set(session, result['identifier'])
		if (session === this.#session)
			await this.#client.send(
				'Runtime.evaluate',
				{ expression: BROWSER_CODEGEN_SOURCE },
				{ session },
			)
	}
	async #remove(): Promise<void> {
		await Promise.all(
			[...this.#sessions].map(async ([session, entry]) => {
				await entry.attempt.catch(() => undefined)
				const identifier = this.#scripts.get(session)
				if (identifier !== undefined)
					await this.#client
						.send('Page.removeScriptToEvaluateOnNewDocument', { identifier }, { session })
						.catch(() => undefined)
				// Removing the binding acknowledges reports already sent by this renderer.
				await this.#client
					.send('Runtime.removeBinding', { name: BROWSER_CODEGEN_BINDING_NAME }, { session })
					.catch(() => undefined)
				for (const [method, handler] of entry.handlers)
					this.#client.unsubscribe(method, handler, session)
				const expression = `window[${JSON.stringify(BROWSER_CODEGEN_BINDING_NAME + '__state')}]?.controller.abort()`
				await Promise.all(
					[undefined, ...entry.contexts].map(async (contextId) => {
						await this.#client
							.send(
								'Runtime.evaluate',
								{ expression, ...(contextId === undefined ? {} : { contextId }) },
								{ session },
							)
							.catch(() => undefined)
					}),
				)
			}),
		)
		this.#sessions.clear()
		this.#scripts.clear()
	}
	#binding(session: string, params: Readonly<Record<string, unknown>>): void {
		if (params['name'] !== BROWSER_CODEGEN_BINDING_NAME) return
		const gesture = parseCodegenActionPayload(params['payload'])
		const context = params['executionContextId']
		if (gesture === undefined || !isInteger(context) || context < 1) return
		this.#sessions.get(session)?.contexts.add(context)
		const key = `${session}:${context}:${gesture.index}`
		const document = `${session}:${context}`
		const epoch = this.#epoch
		// Start the lookup while the node still exists; serialize only the projection.
		const target =
			gesture.top && gesture.event !== 'submit' && gesture.event !== 'focusout'
				? this.#target(session, context, gesture.index).catch(() => undefined)
				: Promise.resolve(undefined)
		this.#queue = this.#queue.then(async () => {
			const resolved = await target
			if (epoch !== this.#epoch) return
			this.#project(gesture, key, document, resolved)
		})
	}
	async #target(
		session: string,
		contextId: number,
		index: number,
	): Promise<BrowserJourneyTarget | undefined> {
		const result = await this.#client.send(
			'Runtime.evaluate',
			{
				expression: `window[${JSON.stringify(BROWSER_CODEGEN_BINDING_NAME + '__state')}].nodes[${index}]`,
				contextId,
			},
			{ session },
		)
		if (!isRecord(result) || !isRecord(result['result']) || !isString(result['result']['objectId']))
			return undefined
		const objectId = result['result']['objectId']
		try {
			const tree = await this.#client.send(
				'Accessibility.getPartialAXTree',
				{ objectId, fetchRelatives: true },
				{ session },
			)
			if (!isRecord(tree) || !isArray(tree['nodes'])) return undefined
			for (const node of tree['nodes']) {
				if (!isRecord(node) || node['ignored'] === true) continue
				const role = readBrowserAXValue(node['role'])
				const name = readBrowserAXValue(node['name'])
				if (isString(role) && BROWSER_INTERACTIVE_ROLES.has(role) && isString(name))
					return { role, name }
			}
			return undefined
		} finally {
			await this.#client
				.send('Runtime.releaseObject', { objectId }, { session })
				.catch(() => undefined)
		}
	}
	#project(
		gesture: BrowserCodegenGesture,
		key: string,
		document: string,
		target: BrowserJourneyTarget | undefined,
	): void {
		if (gesture.event === 'submit') {
			this.#enter = undefined
			this.#flush()
			return
		}
		if (gesture.event === 'focusout') {
			if (this.#pending?.key === key) this.#flush()
			this.#enter = undefined
			return
		}
		if (
			gesture.event === 'change' &&
			(gesture.control === 'text' || gesture.control === 'password')
		)
			return
		if (gesture.event === 'input' && ['select', 'multiple', 'option'].includes(gesture.control))
			return
		if (gesture.event === 'click' && ['select', 'multiple', 'option'].includes(gesture.control))
			return
		if (gesture.event === 'click' && gesture.detail === 0 && this.#enter === document) return
		if (!gesture.top) {
			this.#gap('the element is in a child frame')
			return
		}
		if (gesture.event === 'unsupported') {
			this.#gap(gesture.gap ?? 'an unsupported gesture')
			return
		}
		if (gesture.event === 'keydown') {
			if (this.#pending?.key === key && this.#pending.step.action === 'type') {
				if (gesture.form)
					this.#pending = {
						key,
						step: {
							...this.#pending.step,
							arguments: { ...this.#pending.step.arguments, submit: true },
						},
					}
				this.#flush()
				if (!gesture.form) this.#append({ action: 'press', arguments: { key: 'Enter' } })
			} else {
				this.#flush()
				this.#append({ action: 'press', arguments: { key: 'Enter' } })
			}
			this.#enter = gesture.form ? document : undefined
			return
		}
		this.#enter = undefined
		if (gesture.event === 'change' && gesture.control === 'multiple') {
			this.#gap('a multiple selection')
			return
		}
		if (gesture.event === 'change' && gesture.control === 'select' && !gesture.roundtrip) {
			this.#gap('the option does not round-trip')
			return
		}
		if (target === undefined) {
			this.#gap('the element has no portable accessible target')
			return
		}
		if (gesture.event === 'click') {
			this.#flush()
			const step = { action: 'click', arguments: {}, target }
			if (gesture.control === 'text' || gesture.control === 'password')
				this.#pending = { key, step }
			else this.#append(step)
			return
		}
		if (
			gesture.event === 'input' &&
			(gesture.control === 'text' || gesture.control === 'password')
		) {
			if (this.#pending?.key !== key) this.#flush()
			let text = gesture.secret ? this.#pending?.step.arguments['text'] : gesture.value
			if (gesture.secret && !isRecord(text)) {
				const taken = collectBrowserJourneySecrets(this.#steps)
				text = {
					parameter: deriveBrowserJourneySecret(isString(target.name) ? target.name : '', taken),
				}
			}
			this.#pending = { key, step: { action: 'type', arguments: { text: text ?? '' }, target } }
			return
		}
		if (gesture.event === 'change' && gesture.control === 'select') {
			this.#flush()
			this.#append({ action: 'type', arguments: { text: gesture.value ?? '' }, target })
			return
		}
		this.#gap('an unsupported gesture')
	}
	#append(step: BrowserJourneyStepInput): void {
		const recorded = structuredClone({ ...step, id: `s${this.#steps.length + 1}` })
		this.#steps = [...this.#steps, recorded]
		this.#emitter.emit('step', structuredClone(recorded))
	}
	#flush(): void {
		if (this.#pending === undefined) return
		const pending = this.#pending
		this.#pending = undefined
		this.#append(pending.step)
	}
	#gap(gap: string): void {
		this.#flush()
		this.#append({ action: 'unresolved', arguments: {}, gap })
	}
	#navigation(session: string, params: Readonly<Record<string, unknown>>): void {
		if (session !== this.#session) return
		const id = params['frameId']
		if (isString(id) && id !== this.#frame) return
		const frame = params['frame']
		if (isRecord(frame) && 'parentId' in frame) return
		if (isRecord(frame) && isString(frame['id'])) this.#frame = frame['id']
		const epoch = this.#epoch
		this.#queue = this.#queue.then(() => {
			if (epoch === this.#epoch) {
				this.#flush()
				this.#enter = undefined
			}
		})
	}
	#dialog(): void {
		const epoch = this.#epoch
		this.#queue = this.#queue.then(() => {
			if (epoch === this.#epoch) this.#gap('a native dialog answer')
		})
	}
}
