import type { BrowserContextInterface, BrowserPageInterface } from '@src/core'
import type { LoopbackInterface } from '@orkestrel/test/server'
import { createServer } from 'node:http'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { isArray, isRecord, isString } from '@orkestrel/contract'
import { createRecorder, createTeardown, requireValue, waitForCondition } from '@orkestrel/test'
import { createLoopback } from '@orkestrel/test/server'
import { BrowserContext, createCDPClient } from '@src/core'
import { createBrowser, createWebSocketCDPTransport } from '@src/server'
import { createTempDirectory, reservePort } from '../setupServer.js'
import { requireSystemBrowser, SERVICE_BROWSER_ARGS } from '../setupService.js'
import { BROWSER_CODEGEN_FIXTURE, BROWSER_CODEGEN_ORACLE, projectCodegenOracle } from '../setup.js'

describe('claim 12: page recorder against the fixture event log', () => {
	const cleanup = createTeardown()
	const inbound = createRecorder<[string]>()
	let server: LoopbackInterface
	let context: BrowserContextInterface
	let page: BrowserPageInterface

	beforeAll(async () => {
		server = await createLoopback(
			createServer((request, response) => {
				response.writeHead(200, { 'content-type': 'text/html' })
				const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
				if (path === '/child' || path === '/remote') {
					const name = path === '/child' ? 'Accept terms' : 'Pay now'
					response.end(
						`<body><button id="child-button" data-role="button" data-name="${name}">${name}</button><script>${BROWSER_CODEGEN_ORACLE}</script>`,
					)
				} else if (path === '/sink') response.end('<body>Submitted</body>')
				else
					response.end(
						BROWSER_CODEGEN_FIXTURE.replace('REMOTE_URL', `http://localhost:${server.port}/remote`),
					)
			}),
		)
		cleanup.add(() => server.destroy())
		const profile = createTempDirectory('codegen-service-')
		cleanup.add(() => profile.destroy())
		const port = await reservePort()
		const browser = createBrowser({
			executable: requireSystemBrowser().executable,
			headless: true,
			profile: profile.path,
			args: [...SERVICE_BROWSER_ARGS, '--site-per-process'],
			cdp: { port },
			timeout: 20_000,
		})
		cleanup.add(() => browser.destroy())
		await browser.connect()
		const version: unknown = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
		const endpoint = isRecord(version) ? version['webSocketDebuggerUrl'] : undefined
		if (!isString(endpoint)) throw new Error('Chromium reported no debugger URL')
		const transport = createWebSocketCDPTransport({ url: endpoint })
		transport.emitter.on('message', inbound.handler)
		const client = createCDPClient({ transport })
		cleanup.add(() => client.close())
		await client.connect()
		context = new BrowserContext(client)
		cleanup.add(() => context.destroy())
	})
	beforeEach(async () => {
		page = await context.create({ url: `http://127.0.0.1:${server.port}/` })
		inbound.clear()
	})
	afterEach(async () => {
		await page.close()
	})
	afterAll(async () => {
		await cleanup.destroy()
	})

	it('projects trusted edits, Enter, selects, both frame kinds, dialog answers, and password markers', async () => {
		const recorder = await page.codegen()
		await requireValue((await page.elements.find({ css: '#add' }))[0]).click()
		await requireValue((await page.elements.find({ css: '#title' }))[0]).click()
		await page.keyboard.type('Pasta night')
		await page.keyboard.press('Enter')
		await page.evaluate("document.querySelector('#search').focus()")
		await page.keyboard.press('Enter')
		await page.evaluate("document.querySelector('#speed').focus()")
		await page.keyboard.press('ArrowDown')
		await page.keyboard.down('Control')
		try {
			await requireValue((await page.elements.find({ css: '#olives' }))[0]).click()
		} finally {
			await page.keyboard.up('Control')
		}
		const frames = await page.frames()
		expect(frames.some((frame) => frame.url.endsWith('/child'))).toBe(true)
		expect(frames.some((frame) => frame.url.endsWith('/remote'))).toBe(true)
		await requireValue(
			(await page.elements.find({ role: 'button', name: 'Accept terms', exact: true }))[0],
		).click()
		await requireValue(
			(await page.elements.find({ role: 'button', name: 'Pay now', exact: true }))[0],
		).click()
		await waitForCondition('both child clicks reach the independent log', async () => {
			const log = await page.evaluate('JSON.parse(document.body.dataset.codegenLog)')
			return (
				isArray(log) &&
				log.filter(
					(event) => isRecord(event) && event['event'] === 'click' && event['main'] === false,
				).length === 2
			)
		})
		const dialogs = createRecorder<[unknown]>()
		await page.subscribe('Page.javascriptDialogOpening', dialogs.handler)
		const click = requireValue((await page.elements.find({ css: '#discard' }))[0]).click()
		await waitForCondition('the native confirmation opens', () => dialogs.count === 1)
		await page.send('Page.handleJavaScriptDialog', { accept: true })
		await click
		await requireValue((await page.elements.find({ css: '#password' }))[0]).click()
		await page.keyboard.type('teal-Heron-42')
		await page.keyboard.press('Tab')
		await page.evaluate("document.querySelector('#size').focus()")
		await page.keyboard.press('ArrowDown')
		const steps = await recorder.stop()
		const log = await page.evaluate('JSON.parse(document.body.dataset.codegenLog)')
		if (!isArray(log) || !log.every(isRecord)) throw new Error('The fixture log is malformed')
		const projected = projectCodegenOracle(log)
		expect(steps.map(({ id: _id, ...step }) => step)).toEqual(projected)
		expect(steps.map((step) => step.action)).toEqual([
			'click',
			'type',
			'press',
			'type',
			'unresolved',
			'unresolved',
			'unresolved',
			'click',
			'unresolved',
			'type',
			'unresolved',
		])
		expect(steps[1]?.arguments).toEqual({ text: 'Pasta night', submit: true })
		expect(steps[9]?.arguments).toEqual({ text: { parameter: 'password' } })
		expect(steps[10]?.gap).toBe('the option does not round-trip')
		expect(projected.filter((step) => step.gap === 'the element is in a child frame')).toHaveLength(
			2,
		)
		// The independent oracle must disagree when either frame gesture is omitted.
		expect(projected.filter((_, index) => index !== 6)).not.toEqual(projected)
		const framesText = inbound.calls.map(([frame]) => frame).join('\n')
		expect(framesText).not.toContain('teal-Heron-42')
		expect(framesText).not.toContain('teal-')
		expect(framesText).toContain('Pasta night')
		expect(recorder.journey({ name: 'note', description: 'Record a note' }).parameters).toEqual({
			password: { secret: true },
		})
	})

	it('closes edits at submission, focus departure, navigation, and stop, including contenteditable', async () => {
		const recorder = await page.codegen()
		await page.evaluate("document.querySelector('#title').focus()")
		await page.keyboard.insert('first')
		await page.keyboard.press('Enter')
		await page.keyboard.insert(' second')
		await page.keyboard.press('Tab')
		await page.evaluate("document.querySelector('#title').focus()")
		await page.keyboard.insert(' third')
		await page.evaluate("location.hash = 'edited'")
		await page.keyboard.insert(' fourth')
		await page.evaluate("document.querySelector('#editor').focus()")
		await page.keyboard.press('Control+a')
		await page.keyboard.insert('Notes text')
		const steps = await recorder.stop()
		expect(steps.map((step) => step.arguments)).toEqual([
			{ text: 'first', submit: true },
			{ text: 'first second' },
			{ text: 'first second third' },
			{ text: 'first second third fourth' },
			{ text: 'Notes text' },
		])
		expect(steps.every((step) => step.action === 'type')).toBe(true)
		expect(steps.at(-1)?.target).toEqual({ role: 'textbox', name: 'Notes' })
		await page.keyboard.insert(' after stop')
		expect(recorder.steps()).toEqual(steps)
	})
})
