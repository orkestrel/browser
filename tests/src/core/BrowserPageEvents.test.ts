import type {
	BrowserConsoleMessage,
	BrowserDialogInterface,
	BrowserDownloadInterface,
	BrowserFileChooserInterface,
	BrowserFrameInterface,
	BrowserPageInterface,
	BrowserPageError,
	BrowserRequest,
	BrowserRequestFailure,
	BrowserResponse,
	BrowserWebSocketInterface,
	BrowserWorkerInterface,
} from '@src/core'
import { describe, expect, it } from 'vitest'
import { BrowserPage } from '@src/core'
import { createConnectedCDPClient, createRecorder, replyOk, waitForCondition } from '../../setup.js'

describe('BrowserPage events', () => {
	it('emits typed dialogs that can be accepted exactly once', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.handleJavaScriptDialog')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const dialogs = createRecorder<[dialog: BrowserDialogInterface]>()
		page.emitter.on('dialog', dialogs.handler)

		transport.event(
			'Page.javascriptDialogOpening',
			{ type: 'prompt', message: 'Name?', defaultPrompt: 'Ada' },
			'session-1',
		)
		const dialog = dialogs.calls[0]?.[0]
		expect(dialog).toMatchObject({ category: 'prompt', message: 'Name?', default: 'Ada' })
		await dialog?.accept('Grace')

		expect(
			transport.sent.find((message) => message.method === 'Page.handleJavaScriptDialog')?.params,
		).toEqual({ accept: true, promptText: 'Grace' })
	})

	it('allows a dialog response to be retried after protocol failure', async () => {
		const { client, transport } = await createConnectedCDPClient()
		let attempts = 0
		transport.onSend('Page.handleJavaScriptDialog', (message) => {
			attempts += 1
			if (attempts === 1) transport.fail(message.id, 'dialog failed')
			else transport.reply(message.id, {})
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const dialogs = createRecorder<[dialog: BrowserDialogInterface]>()
		page.emitter.on('dialog', dialogs.handler)
		transport.event(
			'Page.javascriptDialogOpening',
			{ type: 'confirm', message: 'Continue?' },
			'session-1',
		)
		const dialog = dialogs.calls[0]?.[0]

		await expect(dialog?.accept()).rejects.toThrow('dialog failed')
		await expect(dialog?.dismiss()).resolves.toBeUndefined()
		expect(attempts).toBe(2)
	})

	it('emits file choosers that set selected paths by backend node id', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'DOM.setFileInputFiles')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const choosers = createRecorder<[chooser: BrowserFileChooserInterface]>()
		page.emitter.on('chooser', choosers.handler)

		transport.event(
			'Page.fileChooserOpened',
			{ backendNodeId: 9, mode: 'selectMultiple' },
			'session-1',
		)
		const chooser = choosers.calls[0]?.[0]
		expect(chooser?.multiple).toBe(true)
		await chooser?.upload(['one.txt', 'two.txt'])

		expect(
			transport.sent.find((message) => message.method === 'DOM.setFileInputFiles')?.params,
		).toEqual({ backendNodeId: 9, files: ['one.txt', 'two.txt'] })
	})

	it('allows a file chooser response to be retried after protocol failure', async () => {
		const { client, transport } = await createConnectedCDPClient()
		let attempts = 0
		transport.onSend('DOM.setFileInputFiles', (message) => {
			attempts += 1
			if (attempts === 1) transport.fail(message.id, 'chooser failed')
			else transport.reply(message.id, {})
		})
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const choosers = createRecorder<[chooser: BrowserFileChooserInterface]>()
		page.emitter.on('chooser', choosers.handler)
		transport.event(
			'Page.fileChooserOpened',
			{ backendNodeId: 9, mode: 'selectSingle' },
			'session-1',
		)
		const chooser = choosers.calls[0]?.[0]

		await expect(chooser?.upload(['one.txt'])).rejects.toThrow('chooser failed')
		await expect(chooser?.cancel()).resolves.toBeUndefined()
		expect(attempts).toBe(2)
	})

	it('decodes console calls and uncaught page errors', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const messages = createRecorder<[message: BrowserConsoleMessage]>()
		const errors = createRecorder<[error: BrowserPageError]>()
		page.emitter.on('console', messages.handler)
		page.emitter.on('error', errors.handler)

		transport.event(
			'Runtime.consoleAPICalled',
			{
				type: 'log',
				timestamp: 1,
				args: [{ value: 'hello' }, { value: 2 }],
				stackTrace: {
					callFrames: [
						{
							url: 'https://example.com/app.js',
							functionName: 'main',
							lineNumber: 1,
							columnNumber: 2,
						},
					],
				},
			},
			'session-1',
		)
		transport.event(
			'Runtime.exceptionThrown',
			{
				timestamp: 2,
				exceptionDetails: {
					text: 'Uncaught',
					exception: { description: 'Error: boom' },
					stackTrace: { callFrames: [] },
				},
			},
			'session-1',
		)

		expect(messages.calls[0]?.[0]).toMatchObject({
			level: 'log',
			text: 'hello 2',
			values: ['hello', 2],
		})
		expect(errors.calls[0]?.[0]).toMatchObject({ message: 'Error: boom', timestamp: 2 })
	})

	it('tracks download progress and completion by guid', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(
			client,
			'target-1',
			'session-1',
			undefined,
			undefined,
			'frame-1',
			'context-1',
		)
		const downloads = createRecorder<[download: BrowserDownloadInterface]>()
		page.emitter.on('download', downloads.handler)

		transport.event('Browser.downloadWillBegin', {
			guid: 'download-1',
			url: 'https://example.com/file',
			suggestedFilename: 'file.txt',
			frameId: 'frame-1',
		})
		const download = downloads.calls[0]?.[0]
		transport.event('Browser.downloadProgress', {
			guid: 'download-1',
			state: 'inProgress',
			receivedBytes: Number.NaN,
			totalBytes: 10,
		})
		expect(download?.status).toBe('pending')
		transport.event('Browser.downloadProgress', {
			guid: 'download-1',
			state: 'completed',
			receivedBytes: 10,
			totalBytes: 10,
			filePath: 'C:\\downloads\\file.txt',
		})

		expect(download).toMatchObject({
			id: 'download-1',
			name: 'file.txt',
			status: 'complete',
			received: 10,
			total: 10,
			path: 'C:\\downloads\\file.txt',
		})
	})

	it('promotes attached worker targets after enabling their Runtime session', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Runtime.enable')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const workers = createRecorder<[worker: BrowserWorkerInterface]>()
		page.emitter.on('worker', workers.handler)

		transport.event(
			'Target.attachedToTarget',
			{
				sessionId: 'worker-session',
				targetInfo: {
					targetId: 'worker-1',
					type: 'worker',
					url: 'https://example.com/worker.js',
				},
			},
			'session-1',
		)
		await waitForCondition(() => workers.count === 1)

		expect(workers.calls[0]?.[0]).toMatchObject({
			id: 'worker-1',
			category: 'worker',
			url: 'https://example.com/worker.js',
		})

		transport.event(
			'Target.detachedFromTarget',
			{ targetId: 'worker-1', sessionId: 'worker-session' },
			'session-1',
		)
		await expect(workers.calls[0]?.[0].evaluate('1')).rejects.toThrow('Browser worker is closed')
	})

	it('creates popup pages with opener identity and initialized protocol domains', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Page.enable')
		replyOk(transport, 'Runtime.enable')
		replyOk(transport, 'Page.getFrameTree', {
			frameTree: { frame: { id: 'popup-frame', url: 'https://example.com/popup' } },
		})
		replyOk(transport, 'Target.setAutoAttach')
		replyOk(transport, 'Page.setInterceptFileChooserDialog')
		replyOk(transport, 'Network.enable')
		const page = new BrowserPage(client, 'target-1', 'session-1')
		const popups = createRecorder<[page: BrowserPageInterface]>()
		page.emitter.on('popup', popups.handler)

		transport.event(
			'Target.attachedToTarget',
			{
				sessionId: 'popup-session',
				targetInfo: {
					targetId: 'popup-1',
					type: 'page',
					url: 'https://example.com/popup',
				},
			},
			'session-1',
		)
		await waitForCondition(() => popups.count === 1)

		const popup = popups.calls[0]?.[0]
		expect(popup).toMatchObject({
			target: 'popup-1',
			url: 'https://example.com/popup',
		})
		expect(popup?.opener).toBe(page)
	})

	it('emits frame attach/detach and crash lifecycle events', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		const attached = createRecorder<[frame: BrowserFrameInterface]>()
		const detached = createRecorder<[frame: string]>()
		const crashed = createRecorder<[]>()
		page.emitter.on('attach', attached.handler)
		page.emitter.on('detach', detached.handler)
		page.emitter.on('crash', crashed.handler)

		transport.event(
			'Page.frameAttached',
			{ frameId: 'frame-2', parentFrameId: 'frame-1' },
			'session-1',
		)
		transport.event('Page.frameDetached', { frameId: 'frame-2' }, 'session-1')
		transport.event('Inspector.targetCrashed', {}, 'session-1')

		expect(attached.calls[0]?.[0]).toMatchObject({ id: 'frame-2', parent: 'frame-1' })
		expect(detached.calls).toEqual([['frame-2']])
		expect(crashed.count).toBe(1)
	})

	it('forwards request, response, failure, and WebSocket entities onto the page emitter', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Network.enable')
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')
		const requests = createRecorder<[request: BrowserRequest]>()
		const responses = createRecorder<[response: BrowserResponse]>()
		const failures = createRecorder<[failure: BrowserRequestFailure]>()
		const sockets = createRecorder<[socket: BrowserWebSocketInterface]>()
		page.emitter.on('request', requests.handler)
		page.emitter.on('response', responses.handler)
		page.emitter.on('failure', failures.handler)
		page.emitter.on('socket', sockets.handler)
		await page.network.start()

		transport.event(
			'Network.requestWillBeSent',
			{
				requestId: 'request-1',
				request: { url: 'https://example.com/', method: 'GET', headers: {} },
			},
			'session-1',
		)
		transport.event(
			'Network.responseReceived',
			{
				requestId: 'request-1',
				loaderId: 'loader-1',
				timestamp: 1,
				response: {
					url: 'https://example.com/',
					status: 200,
					statusText: 'OK',
					headers: {},
					mimeType: 'text/html',
					protocol: 'h2',
				},
			},
			'session-1',
		)
		transport.event(
			'Network.loadingFailed',
			{ requestId: 'request-2', errorText: 'net::ERR_FAILED' },
			'session-1',
		)
		transport.event(
			'Network.webSocketCreated',
			{ requestId: 'socket-1', url: 'wss://example.com/socket' },
			'session-1',
		)

		expect(requests.calls[0]?.[0]).toMatchObject({ id: 'request-1', method: 'GET' })
		expect(responses.calls[0]?.[0]).toMatchObject({ id: 'request-1', status: 200 })
		expect(failures.calls[0]?.[0]).toMatchObject({
			id: 'request-2',
			error: 'net::ERR_FAILED',
		})
		expect(sockets.calls[0]?.[0]).toMatchObject({
			id: 'socket-1',
			url: 'wss://example.com/socket',
		})
	})
})
