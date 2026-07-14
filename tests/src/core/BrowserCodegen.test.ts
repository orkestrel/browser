import { describe, it, expect } from 'vitest'
import { BrowserCodegen, createCDPClient } from '@src/core'
import type { CDPClientInterface } from '@src/core'
import { createCDPTransport, createRecorder, replyOk } from '../../setup.js'
import type { CDPTestTransportInterface } from '../../setup.js'

const SESSION_ID = 'session-1'

// === Helpers

async function createStartedCodegen(): Promise<{
	client: CDPClientInterface
	transport: CDPTestTransportInterface
	codegen: BrowserCodegen
}> {
	const transport = createCDPTransport()
	const client = createCDPClient({ transport })
	await client.connect()

	replyOk(transport, 'Runtime.enable')
	replyOk(transport, 'Runtime.addBinding')
	replyOk(transport, 'Page.addScriptToEvaluateOnNewDocument')
	replyOk(transport, 'Runtime.evaluate')

	const codegen = new BrowserCodegen(client, SESSION_ID)
	await codegen.start()

	return { client, transport, codegen }
}

function bindingPayload(payload: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
	return { name: '__orkestrelBrowserCodegen', payload: JSON.stringify(payload) }
}

// === BrowserCodegen

describe('BrowserCodegen', () => {
	describe('start()', () => {
		it('enables the domain, adds the binding, and injects the recorder script', async () => {
			const { transport, codegen } = await createStartedCodegen()

			expect(codegen.started).toBe(true)
			expect(transport.sent.some((m) => m.method === 'Runtime.addBinding')).toBe(true)
			expect(transport.sent.some((m) => m.method === 'Page.addScriptToEvaluateOnNewDocument')).toBe(true)
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
	})

	describe('action capture', () => {
		it('records a click delivered through the binding', async () => {
			const { transport, codegen } = await createStartedCodegen()

			transport.event('Runtime.bindingCalled', bindingPayload({ action: 'click', selector: '#b' }), SESSION_ID)

			expect(codegen.actions()).toEqual([{ action: 'click', selector: '#b' }])
		})

		it('collapses consecutive fills on the same selector into the latest value', async () => {
			const { transport, codegen } = await createStartedCodegen()

			transport.event('Runtime.bindingCalled', bindingPayload({ action: 'fill', selector: '#x', value: 'a' }), SESSION_ID)
			transport.event('Runtime.bindingCalled', bindingPayload({ action: 'fill', selector: '#x', value: 'ab' }), SESSION_ID)
			transport.event('Runtime.bindingCalled', bindingPayload({ action: 'fill', selector: '#x', value: 'abc' }), SESSION_ID)

			expect(codegen.actions()).toEqual([{ action: 'fill', selector: '#x', value: 'abc' }])
		})

		it('drops malformed payloads', async () => {
			const { transport, codegen } = await createStartedCodegen()

			transport.event('Runtime.bindingCalled', bindingPayload({ action: 'unknown' }), SESSION_ID)
			transport.event('Runtime.bindingCalled', { name: '__orkestrelBrowserCodegen', payload: 'not json' }, SESSION_ID)

			expect(codegen.actions()).toEqual([])
		})

		it('ignores binding calls for a different binding name', async () => {
			const { transport, codegen } = await createStartedCodegen()

			transport.event('Runtime.bindingCalled', { name: 'someOtherBinding', payload: JSON.stringify({ action: 'click', selector: '#x' }) }, SESSION_ID)

			expect(codegen.actions()).toEqual([])
		})

		it('records a navigate action for a main-frame navigation', async () => {
			const { transport, codegen } = await createStartedCodegen()

			transport.event('Page.frameNavigated', { frame: { url: 'https://example.com/next' } }, SESSION_ID)

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

			transport.event('Runtime.bindingCalled', bindingPayload({ action: 'click', selector: '#a' }), SESSION_ID)

			expect(recorder.count).toBe(1)
		})
	})

	describe('script()', () => {
		it('compiles recorded actions to JavaScript by default', async () => {
			const { transport, codegen } = await createStartedCodegen()
			transport.event('Runtime.bindingCalled', bindingPayload({ action: 'click', selector: '#x' }), SESSION_ID)

			const script = codegen.script()

			expect(script).toContain('async function run(page) {')
			expect(script).toContain("await page.click(\"#x\")")
		})

		it('compiles recorded actions to TypeScript when requested', async () => {
			const { transport, codegen } = await createStartedCodegen()
			transport.event('Runtime.bindingCalled', bindingPayload({ action: 'click', selector: '#x' }), SESSION_ID)

			const script = codegen.script({ language: 'typescript' })

			expect(script).toContain("import('@orkestrel/browser').BrowserPageInterface")
		})
	})

	describe('clear()', () => {
		it('empties the action log and emits clear', async () => {
			const { transport, codegen } = await createStartedCodegen()
			const recorder = createRecorder<[]>()
			codegen.emitter.on('clear', recorder.handler)

			transport.event('Runtime.bindingCalled', bindingPayload({ action: 'click', selector: '#x' }), SESSION_ID)
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
			transport.event('Runtime.bindingCalled', bindingPayload({ action: 'click', selector: '#a' }), SESSION_ID)

			const snapshot = await codegen.stop()

			expect(snapshot).toEqual([{ action: 'click', selector: '#a' }])
			expect(codegen.started).toBe(false)
		})

		it('stops receiving further binding calls after stop', async () => {
			const { transport, codegen } = await createStartedCodegen()
			await codegen.stop()

			transport.event('Runtime.bindingCalled', bindingPayload({ action: 'click', selector: '#b' }), SESSION_ID)

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
			transport.event('Runtime.bindingCalled', bindingPayload({ action: 'click', selector: '#x' }), SESSION_ID)

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
