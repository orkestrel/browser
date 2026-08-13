import { describe, it, expect } from 'vitest'
import { BrowserCodegen, createCDPClient } from '@src/core'
import { createRecorder } from '@orkestrel/test'
import {
	createCDPTransport,
	createCodegenBindingPayload,
	createStartedCodegen,
	replyOk,
	throwListenerError,
} from '../../setup.js'

const SESSION_ID = 'session-1'

// === BrowserCodegen

describe('BrowserCodegen', () => {
	describe('start()', () => {
		it('enables the domain, adds the binding, and injects the recorder script', async () => {
			const { transport, codegen } = await createStartedCodegen()

			expect(codegen.started).toBe(true)
			expect(transport.sent.some((m) => m.method === 'Runtime.addBinding')).toBe(true)
			expect(transport.sent.some((m) => m.method === 'Page.addScriptToEvaluateOnNewDocument')).toBe(
				true,
			)
		})

		it('emits start exactly once', async () => {
			const recorder = createRecorder<[]>()
			const transport = createCDPTransport()
			const client = createCDPClient({ transport })
			await client.connect()
			replyOk(transport, 'Runtime.enable')
			replyOk(transport, 'Runtime.addBinding')
			replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
			replyOk(transport, 'Runtime.evaluate')

			const codegen = new BrowserCodegen(client, SESSION_ID, { on: { start: recorder.handler } })
			await codegen.start()
			await codegen.start()

			expect(recorder.count).toBe(1)
		})

		it('is a no-op the second time it is called', async () => {
			const { transport, codegen } = await createStartedCodegen()
			const before = transport.sent.length

			await codegen.start()

			expect(transport.sent.length).toBe(before)
		})

		it('shares one in-flight start across concurrent callers', async () => {
			const transport = createCDPTransport()
			const client = createCDPClient({ transport })
			await client.connect()
			let enableId: number | undefined
			transport.onSend('Runtime.enable', (message) => {
				enableId = message.id
			})
			replyOk(transport, 'Runtime.addBinding')
			replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
			replyOk(transport, 'Runtime.evaluate')

			const codegen = new BrowserCodegen(client, SESSION_ID)
			const first = codegen.start()
			const second = codegen.start()
			expect(codegen.started).toBe(false)
			if (enableId === undefined) throw new Error('Runtime.enable was not sent')
			transport.reply(enableId, {})

			await Promise.all([first, second])
			expect(codegen.started).toBe(true)
			expect(transport.sent.filter((message) => message.method === 'Runtime.enable')).toHaveLength(
				1,
			)
		})

		it('forwards listener failures to the configured emitter error handler', async () => {
			const transport = createCDPTransport()
			const client = createCDPClient({ transport })
			await client.connect()
			replyOk(transport, 'Runtime.enable')
			replyOk(transport, 'Runtime.addBinding')
			replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
			replyOk(transport, 'Runtime.evaluate')
			const errors = createRecorder<[unknown, string]>()
			const codegen = new BrowserCodegen(client, SESSION_ID, {
				on: {
					start: throwListenerError,
				},
				error: errors.handler,
			})

			await expect(codegen.start()).resolves.toBeUndefined()
			expect(errors.count).toBe(1)
			expect(errors.calls[0]?.[1]).toBe('start')
		})

		it('unsubscribes everything armed and allows a retry after a failed start()', async () => {
			const transport = createCDPTransport()
			const client = createCDPClient({ transport })
			await client.connect()

			let enableCalls = 0
			transport.onSend('Runtime.enable', (message) => {
				enableCalls += 1
				if (enableCalls === 1) {
					transport.fail(message.id, 'boom')
				} else {
					transport.reply(message.id, {})
				}
			})

			const codegen = new BrowserCodegen(client, SESSION_ID)
			await expect(codegen.start()).rejects.toThrow('boom')
			expect(codegen.started).toBe(false)

			// No subscriptions should remain armed after the failed start
			transport.event(
				'Runtime.bindingCalled',
				createCodegenBindingPayload({ action: 'click', selector: '#x' }),
				SESSION_ID,
			)
			expect(codegen.actions()).toEqual([])

			// A retry must succeed cleanly
			replyOk(transport, 'Runtime.addBinding')
			replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
			replyOk(transport, 'Runtime.evaluate')

			await codegen.start()
			expect(codegen.started).toBe(true)
		})
	})

	describe('action capture', () => {
		it('records a click delivered through the binding', async () => {
			const { transport, codegen } = await createStartedCodegen()

			transport.event(
				'Runtime.bindingCalled',
				createCodegenBindingPayload({ action: 'click', selector: '#b' }),
				SESSION_ID,
			)

			expect(codegen.actions()).toEqual([{ action: 'click', selector: '#b' }])
		})

		it('collapses consecutive fills on the same selector into the latest value', async () => {
			const { transport, codegen } = await createStartedCodegen()

			transport.event(
				'Runtime.bindingCalled',
				createCodegenBindingPayload({ action: 'fill', selector: '#x', value: 'a' }),
				SESSION_ID,
			)
			transport.event(
				'Runtime.bindingCalled',
				createCodegenBindingPayload({ action: 'fill', selector: '#x', value: 'ab' }),
				SESSION_ID,
			)
			transport.event(
				'Runtime.bindingCalled',
				createCodegenBindingPayload({ action: 'fill', selector: '#x', value: 'abc' }),
				SESSION_ID,
			)

			expect(codegen.actions()).toEqual([{ action: 'fill', selector: '#x', value: 'abc' }])
		})

		it('drops malformed payloads', async () => {
			const { transport, codegen } = await createStartedCodegen()

			transport.event(
				'Runtime.bindingCalled',
				createCodegenBindingPayload({ action: 'unknown' }),
				SESSION_ID,
			)
			transport.event(
				'Runtime.bindingCalled',
				{ name: '__orkestrelBrowserCodegen', payload: 'not json' },
				SESSION_ID,
			)

			expect(codegen.actions()).toEqual([])
		})

		it('ignores binding calls for a different binding name', async () => {
			const { transport, codegen } = await createStartedCodegen()

			transport.event(
				'Runtime.bindingCalled',
				{ name: 'someOtherBinding', payload: JSON.stringify({ action: 'click', selector: '#x' }) },
				SESSION_ID,
			)

			expect(codegen.actions()).toEqual([])
		})

		it('records a navigate action for a main-frame navigation', async () => {
			const { transport, codegen } = await createStartedCodegen()

			transport.event(
				'Page.frameNavigated',
				{ frame: { url: 'https://example.com/next' } },
				SESSION_ID,
			)

			expect(codegen.actions()).toEqual([{ action: 'navigate', url: 'https://example.com/next' }])
		})

		it('ignores a sub-frame navigation', async () => {
			const { transport, codegen } = await createStartedCodegen()

			transport.event(
				'Page.frameNavigated',
				{ frame: { url: 'https://example.com/frame', parentId: 'main-frame' } },
				SESSION_ID,
			)

			expect(codegen.actions()).toEqual([])
		})

		it('emits action for each captured action', async () => {
			const { transport, codegen } = await createStartedCodegen()
			const recorder = createRecorder<[unknown]>()
			codegen.emitter.on('action', recorder.handler)

			transport.event(
				'Runtime.bindingCalled',
				createCodegenBindingPayload({ action: 'click', selector: '#a' }),
				SESSION_ID,
			)

			expect(recorder.count).toBe(1)
		})
	})

	describe('script()', () => {
		it('compiles recorded actions to JavaScript by default', async () => {
			const { transport, codegen } = await createStartedCodegen()
			transport.event(
				'Runtime.bindingCalled',
				createCodegenBindingPayload({ action: 'click', selector: '#x' }),
				SESSION_ID,
			)

			const script = codegen.script()

			expect(script).toContain('async function run(page) {')
			expect(script).toContain('await page.click("#x")')
		})

		it('compiles recorded actions to TypeScript when requested', async () => {
			const { transport, codegen } = await createStartedCodegen()
			transport.event(
				'Runtime.bindingCalled',
				createCodegenBindingPayload({ action: 'click', selector: '#x' }),
				SESSION_ID,
			)

			const script = codegen.script({ language: 'typescript' })

			expect(script).toContain("import('@orkestrel/browser').BrowserPageInterface")
		})
	})

	describe('clear()', () => {
		it('empties the action log and emits clear', async () => {
			const { transport, codegen } = await createStartedCodegen()
			const recorder = createRecorder<[]>()
			codegen.emitter.on('clear', recorder.handler)

			transport.event(
				'Runtime.bindingCalled',
				createCodegenBindingPayload({ action: 'click', selector: '#x' }),
				SESSION_ID,
			)
			expect(codegen.actions()).toHaveLength(1)

			codegen.clear()

			expect(codegen.actions()).toEqual([])
			expect(recorder.count).toBe(1)
		})

		it('emits clear even when the log is already empty', async () => {
			const { codegen } = await createStartedCodegen()
			const recorder = createRecorder<[]>()
			codegen.emitter.on('clear', recorder.handler)

			codegen.clear()

			expect(recorder.count).toBe(1)
		})
	})

	describe('stop()', () => {
		it('detaches listeners and returns the snapshot', async () => {
			const { transport, codegen } = await createStartedCodegen()
			transport.event(
				'Runtime.bindingCalled',
				createCodegenBindingPayload({ action: 'click', selector: '#a' }),
				SESSION_ID,
			)

			const snapshot = await codegen.stop()

			expect(snapshot).toEqual([{ action: 'click', selector: '#a' }])
			expect(codegen.started).toBe(false)
		})

		it('stops receiving further binding calls after stop', async () => {
			const { transport, codegen } = await createStartedCodegen()
			await codegen.stop()

			transport.event(
				'Runtime.bindingCalled',
				createCodegenBindingPayload({ action: 'click', selector: '#b' }),
				SESSION_ID,
			)

			expect(codegen.actions()).toEqual([])
		})

		it('is a no-op returning the current snapshot when never started', async () => {
			const transport = createCDPTransport()
			const client = createCDPClient({ transport })
			await client.connect()

			const codegen = new BrowserCodegen(client, SESSION_ID)
			const snapshot = await codegen.stop()

			expect(snapshot).toEqual([])
		})
	})

	describe('destroy()', () => {
		it('stops the recorder, clears the log, and destroys the emitter', async () => {
			const { transport, codegen } = await createStartedCodegen()
			transport.event(
				'Runtime.bindingCalled',
				createCodegenBindingPayload({ action: 'click', selector: '#x' }),
				SESSION_ID,
			)

			await codegen.destroy()

			expect(codegen.started).toBe(false)
			expect(codegen.actions()).toEqual([])
			expect(codegen.emitter.destroyed).toBe(true)
		})

		it('is idempotent', async () => {
			const { codegen } = await createStartedCodegen()
			await codegen.destroy()
			await expect(codegen.destroy()).resolves.toBeUndefined()
		})
	})
})
