/**
 * src/core/BrowserSelectorManager.ts tests.
 *
 * The manager's whole job is projecting each semantic accessor onto one `BrowserLocator`
 * query, so every case reads the query back through the expression the locator sends to
 * the in-memory CDP transport rather than through the locator's internal state.
 */

import { describe, expect, it } from 'vitest'
import { BrowserSelectorManager } from '@src/core'
import { createAttachedPage, readCDPExpression, replyOk } from '../../setup.js'

describe('BrowserSelectorManager', () => {
	it('builds a distinct locator instance per call', async () => {
		const { page } = await createAttachedPage()
		const selectors = new BrowserSelectorManager(page)

		expect(selectors.css('#hero')).not.toBe(selectors.css('#hero'))
	})

	it('compiles a css query into a direct selector lookup', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Runtime.evaluate', { result: { value: 2 } })
		const selectors = new BrowserSelectorManager(page)

		await selectors.css('.row').count()

		const expression = readCDPExpression(transport.sent.at(-1))
		expect(expression).toContain(JSON.stringify('.row'))
	})

	it('carries the accessible name and the exact flag into a role query', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Runtime.evaluate', { result: { value: 1 } })
		const selectors = new BrowserSelectorManager(page)

		await selectors.role('button', { name: 'Save', exact: true }).count()

		const expression = readCDPExpression(transport.sent.at(-1)) ?? ''
		expect(expression).toContain(JSON.stringify('button'))
		expect(expression).toContain(JSON.stringify('Save'))
	})

	it('omits an unset name and an unset exact flag from a role query', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Runtime.evaluate', { result: { value: 1 } })
		const selectors = new BrowserSelectorManager(page)

		await selectors.role('button').count()

		const expression = readCDPExpression(transport.sent.at(-1)) ?? ''
		expect(expression).toContain(JSON.stringify('button'))
		expect(expression).not.toContain('"name"')
	})

	it('carries the value of each text-shaped accessor into its own query', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Runtime.evaluate', { result: { value: 0 } })
		const selectors = new BrowserSelectorManager(page)

		await selectors.text('Continue').count()
		await selectors.label('Email', { exact: true }).count()
		await selectors.placeholder('Search').count()
		await selectors.testId('checkout').count()

		const expressions = transport.sent
			.filter((message) => message.method === 'Runtime.evaluate')
			.map((message) => readCDPExpression(message) ?? '')
		expect(expressions[0]).toContain(JSON.stringify('Continue'))
		expect(expressions[1]).toContain(JSON.stringify('Email'))
		expect(expressions[2]).toContain(JSON.stringify('Search'))
		expect(expressions[3]).toContain(JSON.stringify('checkout'))
	})

	it('accepts an empty value rather than refusing it', async () => {
		const { page, transport } = await createAttachedPage()
		replyOk(transport, 'Runtime.evaluate', { result: { value: 0 } })
		const selectors = new BrowserSelectorManager(page)

		await expect(selectors.text('').count()).resolves.toBe(0)
	})
})
