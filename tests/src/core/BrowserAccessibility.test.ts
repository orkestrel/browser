import { describe, expect, it } from 'vitest'
import { BrowserPage, isBrowserError } from '@src/core'
import { createConnectedCDPClient, replyOk } from '../../setup.js'

describe('BrowserAccessibility', () => {
	it('decodes a flat AX tree with roots, relationships, properties, and values', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Accessibility.enable')
		replyOk(transport, 'Accessibility.disable')
		replyOk(transport, 'Accessibility.getFullAXTree', {
			nodes: [
				{
					nodeId: 'root',
					childIds: ['button'],
					ignored: false,
					role: { type: 'role', value: 'RootWebArea' },
					name: { type: 'computedString', value: 'Example' },
				},
				{
					nodeId: 'button',
					parentId: 'root',
					backendDOMNodeId: 7,
					ignored: false,
					role: { type: 'role', value: 'button' },
					name: { type: 'computedString', value: 'Save' },
					properties: [{ name: 'focusable', value: { type: 'booleanOrUndefined', value: true } }],
				},
			],
		})
		const page = new BrowserPage(client, 'target-1', 'session-1', undefined, undefined, 'frame-1')

		const tree = await page.accessibility.snapshot({ depth: 3 })

		expect(tree.roots).toEqual(['root'])
		expect(tree.nodes[1]).toMatchObject({
			id: 'button',
			parent: 'root',
			backend: 7,
			role: 'button',
			name: 'Save',
			properties: { focusable: true },
		})
		expect(
			transport.sent.find((message) => message.method === 'Accessibility.getFullAXTree')?.params,
		).toEqual({ depth: 3, frameId: 'frame-1' })
	})

	it('uses partial-tree lookup for a backend root and rejects malformed nodes', async () => {
		const { client, transport } = await createConnectedCDPClient()
		replyOk(transport, 'Accessibility.enable')
		replyOk(transport, 'Accessibility.disable')
		replyOk(transport, 'Accessibility.getPartialAXTree', { nodes: [{}] })
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.accessibility.snapshot({ root: 4 })).rejects.toSatisfy(isBrowserError)
		expect(
			transport.sent.find((message) => message.method === 'Accessibility.getPartialAXTree')?.params,
		).toEqual({ backendNodeId: 4, fetchRelatives: true })
	})

	it('rejects invalid roots and depths before enabling the domain', async () => {
		const { client, transport } = await createConnectedCDPClient()
		const page = new BrowserPage(client, 'target-1', 'session-1')

		await expect(page.accessibility.snapshot({ root: 0 })).rejects.toSatisfy(isBrowserError)
		await expect(page.accessibility.snapshot({ depth: 1.5 })).rejects.toSatisfy(isBrowserError)

		expect(transport.sent).toEqual([])
	})
})
