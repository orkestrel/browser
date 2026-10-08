import type { BrowserWebSocketFrame } from './types.js'
import { decodeBase64 } from '@orkestrel/codec'
import type {
	BrowserCredentials,
	BrowserFrameInterface,
	BrowserHARManagerInterface,
	BrowserNetworkEventMap,
	BrowserNetworkManagerInterface,
	BrowserRouteDefinition,
	BrowserRouteManagerInterface,
	BrowserNetworkOptions,
	BrowserWriterInterface,
} from './types.js'
import type { EmitterInterface } from '@orkestrel/emitter'
import { BrowserTransition } from './BrowserTransition.js'
import { BrowserHARManager } from './BrowserHARManager.js'
import { BrowserRouteManager } from './BrowserRouteManager.js'
import { BrowserRoute } from './BrowserRoute.js'
import { BrowserWebSocket } from './BrowserWebSocket.js'
import { matchesBrowserRoute, settleBrowserTeardown } from './helpers.js'
import {
	parseBrowserRequest,
	parseBrowserRequestFailure,
	parseBrowserResponse,
	parseBrowserWebSocketFrame,
} from './parsers.js'
import { BrowserError } from './errors.js'
import { attempt, isFiniteNumber, isRecord, isString, isJSONValue } from '@orkestrel/contract'
import { Emitter } from '@orkestrel/emitter'

/**
 * Drives the page-scoped Network and Fetch domain lifecycle.
 *
 * @remarks The owner exposes this entity through `page.network`.
 */
export class BrowserNetworkManager implements BrowserNetworkManagerInterface {
	readonly #frame: BrowserFrameInterface
	readonly #emitter: Emitter<BrowserNetworkEventMap>
	readonly #har: BrowserHARManager
	readonly #routes: BrowserRouteDefinition[] = []
	readonly #manager: BrowserRouteManager
	readonly #sockets: Map<
		string,
		{
			readonly receive: (frame: BrowserWebSocketFrame) => void
			readonly transmit: (frame: BrowserWebSocketFrame) => void
			readonly fail: (message: string) => void
			readonly close: (timestamp: number) => void
		}
	> = new Map()
	#credentials: BrowserCredentials | undefined
	#started = false
	#intercepting = false
	#destroyed = false
	readonly #starting: BrowserTransition = new BrowserTransition()
	readonly #requestHandler = this.#handleRequest.bind(this)
	readonly #responseHandler = this.#handleResponse.bind(this)
	readonly #failureHandler = this.#handleFailure.bind(this)
	readonly #finishHandler = this.#handleFinish.bind(this)
	readonly #pausedHandler = this.#handlePause.bind(this)
	readonly #authHandler = this.#handleAuth.bind(this)
	readonly #socketHandler = this.#handleSocket.bind(this)
	readonly #socketReceiveHandler = this.#handleSocketReceive.bind(this)
	readonly #socketTransmitHandler = this.#handleSocketTransmit.bind(this)
	readonly #socketErrorHandler = this.#handleSocketError.bind(this)
	readonly #socketCloseHandler = this.#handleSocketClose.bind(this)

	constructor(frame: BrowserFrameInterface, writer?: BrowserWriterInterface) {
		this.#frame = frame
		this.#emitter = new Emitter()
		this.#har = new BrowserHARManager(this, writer)
		this.#manager = new BrowserRouteManager(this.#routes, this.start.bind(this), async () => {
			if (this.#started && !this.#destroyed) await this.#configure()
		})
	}

	get emitter(): EmitterInterface<BrowserNetworkEventMap> {
		return this.#emitter
	}

	get har(): BrowserHARManagerInterface {
		return this.#har
	}

	get routes(): BrowserRouteManagerInterface {
		return this.#manager
	}

	async apply(options: BrowserNetworkOptions): Promise<void> {
		await this.start()
		if (options.headers !== undefined)
			await this.#frame.send('Network.setExtraHTTPHeaders', { headers: options.headers })
		if (options.offline !== undefined)
			await this.#frame.send('Network.emulateNetworkConditions', {
				offline: options.offline,
				latency: 0,
				downloadThroughput: -1,
				uploadThroughput: -1,
			})
		if (options.credentials !== undefined) {
			const previous = this.#credentials
			this.#credentials = { ...options.credentials }
			try {
				await this.#configure()
			} catch (error) {
				this.#credentials = previous
				throw error
			}
		}
	}

	async clear(): Promise<void> {
		await this.apply({ headers: {}, offline: false })
		const previous = this.#credentials
		this.#credentials = undefined
		try {
			await this.#configure()
		} catch (error) {
			this.#credentials = previous
			throw error
		}
	}

	async start(): Promise<void> {
		if (this.#destroyed) throw new BrowserError('CLOSED', 'Browser network manager is destroyed')
		if (this.#started) return
		const active = this.#starting.pending
		if (active !== undefined) {
			await active
			return
		}
		await this.#starting.execute(() => this.#start())
	}

	async body(id: string): Promise<Uint8Array> {
		await this.start()
		const result = await this.#frame.send('Network.getResponseBody', { requestId: id })
		if (!isRecord(result) || !isString(result['body'])) {
			throw new BrowserError('PROTOCOL', 'Browser response body is malformed', { id })
		}
		const bytes =
			result['base64Encoded'] === true
				? decodeBase64(result['body'])
				: new TextEncoder().encode(result['body'])
		if (bytes === undefined)
			throw new BrowserError('PROTOCOL', 'Browser response body has malformed base64 data', { id })
		return bytes
	}

	async text(id: string): Promise<string> {
		return new TextDecoder().decode(await this.body(id))
	}

	async json(id: string): Promise<unknown> {
		const text = await this.text(id)
		const result = attempt<unknown>(() => JSON.parse(text))
		if (result.success) return result.value
		throw new BrowserError('JSON', 'Browser response body is not valid JSON', {
			id,
			error: isJSONValue(result.error) ? result.error : String(result.error),
		})
	}

	async destroy(): Promise<void> {
		if (this.#destroyed) return
		this.#destroyed = true
		const failure = await settleBrowserTeardown(
			() => this.#har.clear(),
			async () => {
				if (this.#intercepting) await this.#frame.send('Fetch.disable')
			},
			async () => {
				if (this.#started) await this.#frame.send('Network.disable')
			},
			() => this.#unsubscribe(),
		)
		for (const socket of this.#sockets.values()) socket.close(Date.now() / 1000)
		this.#sockets.clear()
		this.#routes.length = 0
		this.#emitter.destroy()
		if (failure !== undefined) throw failure
	}

	#handleRequest(params: Readonly<Record<string, unknown>>): void {
		const request = parseBrowserRequest(params)
		if (request !== undefined) this.#emitter.emit('request', request)
	}

	#handleResponse(params: Readonly<Record<string, unknown>>): void {
		const response = parseBrowserResponse(params)
		if (response !== undefined) this.#emitter.emit('response', response)
	}

	#handleFailure(params: Readonly<Record<string, unknown>>): void {
		const failure = parseBrowserRequestFailure(params)
		if (failure !== undefined) this.#emitter.emit('failure', failure)
	}

	#handleFinish(params: Readonly<Record<string, unknown>>): void {
		if (isString(params['requestId'])) this.#emitter.emit('finish', params['requestId'])
	}

	#handlePause(params: Readonly<Record<string, unknown>>): void {
		void this.#route(params).catch(() => undefined)
	}

	#handleAuth(params: Readonly<Record<string, unknown>>): void {
		void this.#authenticate(params).catch(() => undefined)
	}

	#handleSocket(params: Readonly<Record<string, unknown>>): void {
		if (!isString(params['requestId']) || !isString(params['url'])) return
		const id = params['requestId']
		const socket = new BrowserWebSocket(id, params['url'], (driver) => {
			this.#sockets.set(id, driver)
		})
		this.#emitter.emit('socket', socket)
	}

	#handleSocketReceive(params: Readonly<Record<string, unknown>>): void {
		const socket = isString(params['requestId'])
			? this.#sockets.get(params['requestId'])
			: undefined
		const frame = parseBrowserWebSocketFrame(params)
		if (socket !== undefined && frame !== undefined) socket.receive(frame)
	}

	#handleSocketTransmit(params: Readonly<Record<string, unknown>>): void {
		const socket = isString(params['requestId'])
			? this.#sockets.get(params['requestId'])
			: undefined
		const frame = parseBrowserWebSocketFrame(params)
		if (socket !== undefined && frame !== undefined) socket.transmit(frame)
	}

	#handleSocketError(params: Readonly<Record<string, unknown>>): void {
		const socket = isString(params['requestId'])
			? this.#sockets.get(params['requestId'])
			: undefined
		if (socket !== undefined && isString(params['errorMessage']))
			socket.fail(params['errorMessage'])
	}

	#handleSocketClose(params: Readonly<Record<string, unknown>>): void {
		if (!isString(params['requestId'])) return
		const socket = this.#sockets.get(params['requestId'])
		if (socket === undefined) return
		this.#sockets.delete(params['requestId'])
		socket.close(isFiniteNumber(params['timestamp']) ? params['timestamp'] : Date.now() / 1000)
	}

	async #start(): Promise<void> {
		try {
			await this.#subscribe()
			await this.#frame.send('Network.enable')
			this.#started = true
			await this.#configure()
		} catch (error) {
			this.#started = false
			this.#intercepting = false
			await this.#frame.send('Fetch.disable').catch(() => undefined)
			await this.#frame.send('Network.disable').catch(() => undefined)
			await this.#unsubscribe().catch(() => undefined)
			throw error
		}
	}

	async #configure(): Promise<void> {
		const enabled = this.#routes.length > 0 || this.#credentials !== undefined
		if (!enabled) {
			if (this.#intercepting) {
				await this.#frame.send('Fetch.disable')
				this.#intercepting = false
			}
			return
		}
		await this.#frame.send('Fetch.enable', {
			patterns: this.#routes.map((definition) => ({
				urlPattern: definition.query.url ?? '*',
				resourceType: definition.query.resource,
				requestStage: 'Request',
			})),
			handleAuthRequests: this.#credentials !== undefined,
		})
		this.#intercepting = true
	}

	async #route(params: Readonly<Record<string, unknown>>): Promise<void> {
		const request = parseBrowserRequest(params)
		if (request === undefined) {
			if (isString(params['requestId'])) {
				await this.#frame.send('Fetch.failRequest', {
					requestId: params['requestId'],
					errorReason: 'Failed',
				})
			}
			return
		}
		const definition = this.#routes.find((candidate) =>
			matchesBrowserRoute(request, candidate.query),
		)
		if (definition === undefined) {
			await this.#frame.send('Fetch.continueRequest', { requestId: request.id })
			return
		}
		const route = new BrowserRoute(this.#frame, request.id, request)
		try {
			await definition.handler(route)
			if (!route.handled) await route.continue()
		} catch {
			if (!route.handled) await route.abort('Failed').catch(() => undefined)
		}
	}

	async #authenticate(params: Readonly<Record<string, unknown>>): Promise<void> {
		const id = params['requestId']
		if (!isString(id)) return
		const credentials = this.#credentials
		await this.#frame.send('Fetch.continueWithAuth', {
			requestId: id,
			authChallengeResponse:
				credentials === undefined
					? { response: 'Default' }
					: {
							response: 'ProvideCredentials',
							username: credentials.username,
							password: credentials.password,
						},
		})
	}

	async #subscribe(): Promise<void> {
		await this.#frame.subscribe('Network.requestWillBeSent', this.#requestHandler)
		await this.#frame.subscribe('Network.responseReceived', this.#responseHandler)
		await this.#frame.subscribe('Network.loadingFailed', this.#failureHandler)
		await this.#frame.subscribe('Network.loadingFinished', this.#finishHandler)
		await this.#frame.subscribe('Fetch.requestPaused', this.#pausedHandler)
		await this.#frame.subscribe('Fetch.authRequired', this.#authHandler)
		await this.#frame.subscribe('Network.webSocketCreated', this.#socketHandler)
		await this.#frame.subscribe('Network.webSocketFrameReceived', this.#socketReceiveHandler)
		await this.#frame.subscribe('Network.webSocketFrameSent', this.#socketTransmitHandler)
		await this.#frame.subscribe('Network.webSocketFrameError', this.#socketErrorHandler)
		await this.#frame.subscribe('Network.webSocketClosed', this.#socketCloseHandler)
	}

	async #unsubscribe(): Promise<void> {
		await this.#frame.unsubscribe('Network.requestWillBeSent', this.#requestHandler)
		await this.#frame.unsubscribe('Network.responseReceived', this.#responseHandler)
		await this.#frame.unsubscribe('Network.loadingFailed', this.#failureHandler)
		await this.#frame.unsubscribe('Network.loadingFinished', this.#finishHandler)
		await this.#frame.unsubscribe('Fetch.requestPaused', this.#pausedHandler)
		await this.#frame.unsubscribe('Fetch.authRequired', this.#authHandler)
		await this.#frame.unsubscribe('Network.webSocketCreated', this.#socketHandler)
		await this.#frame.unsubscribe('Network.webSocketFrameReceived', this.#socketReceiveHandler)
		await this.#frame.unsubscribe('Network.webSocketFrameSent', this.#socketTransmitHandler)
		await this.#frame.unsubscribe('Network.webSocketFrameError', this.#socketErrorHandler)
		await this.#frame.unsubscribe('Network.webSocketClosed', this.#socketCloseHandler)
	}
}
