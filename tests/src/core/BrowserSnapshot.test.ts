/**
 * src/core/BrowserSnapshot.ts tests.
 */

import type { BrowserSnapshotInput } from '@src/core'
import { describe, expect, it } from 'vitest'
import {
	BrowserSnapshot,
	createBrowserSnapshot,
	readBrowserSnapshot,
	matchesBrowserNode,
} from '@src/core'
import { createDOMSnapshotResult } from '../../setup.js'

describe('BrowserSnapshot', () => {
	it('walks every document and node in stable snapshot order', () => {
		const snapshot = createBrowserSnapshot(
			readBrowserSnapshot(createDOMSnapshotResult(), ['color']),
		)
		const walked = [...snapshot.walk()]

		expect(walked).toHaveLength(9)
		expect(walked.map((node) => `${node.document}:${node.index}`)).toEqual([
			'0:0',
			'0:1',
			'0:2',
			'0:3',
			'0:4',
			'0:5',
			'0:6',
			'1:0',
			'1:1',
		])
	})

	it('resolves documents, direct children, iframe roots, and nearest-first ancestors', () => {
		const snapshot = createBrowserSnapshot(
			readBrowserSnapshot(createDOMSnapshotResult(), ['color']),
		)
		const main = snapshot.documents[0]
		const div = main?.nodes[3]
		const iframe = main?.nodes[6]
		if (div === undefined || iframe === undefined) throw new Error('Snapshot fixture is malformed')

		expect(snapshot.document(div)?.frame).toBe('frame-main')
		expect(snapshot.children(div).map((node) => node.index)).toEqual([4])
		expect(snapshot.children(iframe).map((node) => `${node.document}:${node.index}`)).toEqual([
			'1:0',
		])
		expect(snapshot.ancestors(div).map((node) => node.name)).toEqual(['BODY', 'HTML', '#document'])
		const childBody = snapshot.documents[1]?.nodes[1]
		if (childBody === undefined) throw new Error('Snapshot fixture is malformed')
		expect(snapshot.ancestors(childBody).map((node) => node.name)).toEqual([
			'#document',
			'IFRAME',
			'BODY',
			'HTML',
			'#document',
		])
	})

	it('walks and searches one subtree across an iframe boundary', () => {
		const snapshot = createBrowserSnapshot(
			readBrowserSnapshot(createDOMSnapshotResult(), ['color']),
		)
		const body = snapshot.documents[0]?.nodes[2]
		if (body === undefined) throw new Error('Snapshot fixture is malformed')

		expect([...snapshot.walk({ root: body })].map((node) => node.name)).toEqual([
			'BODY',
			'DIV',
			'#text',
			'INPUT',
			'IFRAME',
			'#document',
			'BODY',
		])
		expect([...snapshot.descendants(body)].map((node) => node.name)).toEqual([
			'DIV',
			'#text',
			'INPUT',
			'IFRAME',
			'#document',
			'BODY',
		])
		expect(
			[...snapshot.descendants(body)].find((node) =>
				matchesBrowserNode(node, { frame: 'frame-child' }),
			)?.name,
		).toBe('#document')
		expect(snapshot.closest(body, (node) => node.name === 'HTML')?.index).toBe(1)
	})

	it('walks breadth-first and resolves parent, sibling, ancestry, and distance relationships', () => {
		const snapshot = createBrowserSnapshot(
			readBrowserSnapshot(createDOMSnapshotResult(), ['color']),
		)
		const body = snapshot.documents[0]?.nodes[2]
		const div = snapshot.documents[0]?.nodes[3]
		const input = snapshot.documents[0]?.nodes[5]
		const iframe = snapshot.documents[0]?.nodes[6]
		const childBody = snapshot.documents[1]?.nodes[1]
		if (
			body === undefined ||
			div === undefined ||
			input === undefined ||
			iframe === undefined ||
			childBody === undefined
		) {
			throw new Error('Snapshot fixture is malformed')
		}

		expect([...snapshot.walk({ root: body, order: 'breadth' })].map((node) => node.name)).toEqual([
			'BODY',
			'DIV',
			'INPUT',
			'IFRAME',
			'#text',
			'#document',
			'BODY',
		])
		const depth = [...snapshot.walk()]
		const breadth = [...snapshot.walk({ order: 'breadth' })]
		expect(breadth).toHaveLength(depth.length)
		expect(new Set(breadth.map((node) => `${node.document}:${node.index}`))).toEqual(
			new Set(depth.map((node) => `${node.document}:${node.index}`)),
		)
		expect(snapshot.parent(input)).toBe(body)
		expect(snapshot.siblings(input).map((node) => node.name)).toEqual(['DIV', 'IFRAME'])
		expect(snapshot.siblings(input, 'preceding')).toEqual([div])
		expect(snapshot.siblings(input, 'following')).toEqual([iframe])
		expect(snapshot.common(div, childBody)).toBe(body)
		expect(snapshot.ancestors(childBody).some((candidate) => candidate === iframe)).toBe(true)
		expect(snapshot.ancestors(body).some((candidate) => candidate === iframe)).toBe(false)
		expect(snapshot.distance(div, childBody)).toBe(4)
	})

	it('finds the first or a bounded list without materializing the full traversal', () => {
		const snapshot = createBrowserSnapshot(
			readBrowserSnapshot(createDOMSnapshotResult(), ['color']),
		)

		expect(snapshot.find((node) => node.name === 'INPUT')?.index).toBe(5)
		expect(snapshot.find(() => false)).toBeUndefined()
		expect(snapshot.filter((node) => node.category === 1, 2)).toHaveLength(2)
		expect(
			snapshot.filter(() => {
				throw new Error('Zero-limit predicate must not run')
			}, 0),
		).toEqual([])
		expect(() => snapshot.filter(() => true, -1)).toThrow(
			'Browser node result limit must be a non-negative integer',
		)
		expect(() => snapshot.filter(() => true, 1.5)).toThrow(
			'Browser node result limit must be a non-negative integer',
		)
		expect(() =>
			snapshot.find(() => {
				throw new Error('Predicate failure')
			}),
		).toThrow('Predicate failure')
	})

	it('matches declarative queries through entity methods', () => {
		const snapshot = createBrowserSnapshot(
			readBrowserSnapshot(createDOMSnapshotResult(), ['color']),
		)
		const node = snapshot.documents[0]?.nodes[3]
		const text = snapshot.documents[0]?.nodes[4]
		if (node === undefined || text === undefined) throw new Error('Snapshot fixture is malformed')

		expect(
			snapshot.find({
				name: 'div',
				text: 'world',
				attributes: { id: 'hero' },
				frame: 'frame-main',
				clickable: true,
				visible: true,
			}),
		).toBe(node)
		expect(snapshot.find({ attributes: { role: 'button' } })).toBeUndefined()
		expect(snapshot.find({ frame: 'frame-child' })?.document).toBe(1)
		expect(snapshot.closest(text, { name: 'div' })).toBe(node)
		expect(snapshot.filter({ visible: true }).includes(node)).toBe(true)
	})

	it('builds deterministic frame-qualified structural paths', () => {
		const snapshot = createBrowserSnapshot(
			readBrowserSnapshot(createDOMSnapshotResult(), ['color']),
		)
		const node = snapshot.documents[0]?.nodes[3]
		if (node === undefined) throw new Error('Snapshot fixture is malformed')

		expect(snapshot.path(node)).toBe('frame("frame-main") > #document:0 > html:1 > body:1 > div:1')
		expect(snapshot.path({ ...node, document: 99, index: 42 })).toBe('document:99 > node:42')
	})

	it('round-trips serializable data and rehydrates navigation', () => {
		const input = readBrowserSnapshot(createDOMSnapshotResult(), ['color'])
		const snapshot = createBrowserSnapshot(input)
		const text = JSON.stringify(snapshot)
		const parsed: BrowserSnapshotInput = JSON.parse(text)
		const data: BrowserSnapshotInput = JSON.parse(JSON.stringify(input))
		const rehydrated = createBrowserSnapshot(parsed)
		const originalNode = snapshot.documents[0]?.nodes[3]
		const parsedNode = rehydrated.documents[0]?.nodes[3]
		if (originalNode === undefined || parsedNode === undefined) {
			throw new Error('Snapshot fixture is malformed')
		}

		expect(Object.keys(parsed)).toEqual(['documents', 'styles'])
		expect(parsed).toEqual(data)
		expect(rehydrated.path(parsedNode)).toBe(snapshot.path(originalNode))
		expect([...rehydrated.walk()]).toHaveLength([...snapshot.walk()].length)
		expect(rehydrated).toBeInstanceOf(BrowserSnapshot)
	})

	it('defensively copies and freezes input arrays', () => {
		const input = readBrowserSnapshot(createDOMSnapshotResult(), ['color'])
		const document = input.documents[0]
		if (document === undefined) throw new Error('Snapshot fixture is malformed')
		const documents = [...input.documents]
		const styles = [...input.styles]
		const snapshot = createBrowserSnapshot({ documents, styles })

		documents.push(document)
		styles.push('display')

		expect(snapshot.documents).toHaveLength(2)
		expect(snapshot.styles).toEqual(['color'])
		expect(Object.isFrozen(snapshot.documents)).toBe(true)
		expect(Object.isFrozen(snapshot.styles)).toBe(true)
	})

	it('seeds orphaned and cyclic nodes once without hanging', () => {
		const input = readBrowserSnapshot(createDOMSnapshotResult())
		const document = input.documents[0]
		const first = document?.nodes[0]
		const second = document?.nodes[1]
		const third = document?.nodes[2]
		if (
			document === undefined ||
			first === undefined ||
			second === undefined ||
			third === undefined
		) {
			throw new Error('Snapshot fixture is malformed')
		}
		const snapshot = createBrowserSnapshot({
			documents: [
				{
					...document,
					nodes: [
						{ ...first, parent: 99 },
						{ ...second, parent: 2 },
						{ ...third, parent: 1 },
					],
				},
			],
			styles: [],
		})
		const walked = [...snapshot.walk()]
		const identities = walked.map((node) => `${node.document}:${node.index}`)

		expect(identities).toEqual(['0:0', '0:1', '0:2'])
		expect(new Set(identities).size).toBe(3)
		expect(snapshot.distance(walked[0] ?? first, walked[1] ?? second)).toBeUndefined()
	})
})
