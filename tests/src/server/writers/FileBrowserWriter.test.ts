/**
 * src/server/writers/FileBrowserWriter.ts tests.
 *
 * The class writes to a real filesystem, so every case drives it against an owned
 * `createScratch` directory and reads the bytes back through `node:fs` rather than
 * through the writer itself.
 */

import type { ScratchInterface } from '@orkestrel/test/server'
import { describe, expect, it, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createScratch } from '@orkestrel/test/server'
import { FileBrowserWriter } from '@src/server'

const scratches: ScratchInterface[] = []
afterEach(() => {
	for (const scratch of scratches.splice(0)) scratch.destroy()
})

function createWriterScratch(): ScratchInterface {
	const scratch = createScratch({ prefix: 'orkestrel-browser-writer-' })
	scratches.push(scratch)
	return scratch
}

describe('FileBrowserWriter', () => {
	it('writes the exact bytes to an existing directory', async () => {
		const scratch = createWriterScratch()
		const writer = new FileBrowserWriter()
		const target = join(scratch.path, 'hero.png')

		await writer.write(target, Uint8Array.from([137, 80, 78, 71, 13]))

		expect([...readFileSync(target)]).toEqual([137, 80, 78, 71, 13])
	})

	it('creates every missing parent directory of the target path', async () => {
		const scratch = createWriterScratch()
		const writer = new FileBrowserWriter()
		const target = join(scratch.path, 'shots', 'nested', 'hero.png')

		await writer.write(target, Uint8Array.from([1, 2, 3]))

		expect([...readFileSync(target)]).toEqual([1, 2, 3])
	})

	it('replaces the previous content of an existing file', async () => {
		const scratch = createWriterScratch()
		const writer = new FileBrowserWriter()
		const target = join(scratch.path, 'hero.png')

		await writer.write(target, Uint8Array.from([1, 2, 3, 4]))
		await writer.write(target, Uint8Array.from([9]))

		expect([...readFileSync(target)]).toEqual([9])
	})

	it('writes an empty payload as an empty file', async () => {
		const scratch = createWriterScratch()
		const writer = new FileBrowserWriter()
		const target = join(scratch.path, 'empty.bin')

		await writer.write(target, new Uint8Array())

		expect([...readFileSync(target)]).toEqual([])
	})

	it('rejects when the target path names an existing directory', async () => {
		const scratch = createWriterScratch()
		const writer = new FileBrowserWriter()
		const target = scratch.ensure('occupied')

		await expect(writer.write(target, Uint8Array.from([1]))).rejects.toThrow('EISDIR')
	})
})
