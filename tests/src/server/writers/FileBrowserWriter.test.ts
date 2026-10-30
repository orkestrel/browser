/**
 * src/server/writers/FileBrowserWriter.ts tests.
 *
 * The class writes to a real filesystem, so every case drives it against an owned
 * `createScratch` directory and reads the bytes back through `node:fs` rather than
 * through the writer itself.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createScratch } from '@orkestrel/test/server'
import { createTeardown } from '@orkestrel/test'
import { FileBrowserWriter } from '@src/server'

const teardown = createTeardown()
afterEach(() => teardown.destroy())

describe('FileBrowserWriter', () => {
	it('writes the exact bytes to an existing directory', async () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-writer-' })
		teardown.add(() => scratch.destroy())
		const writer = new FileBrowserWriter()
		const target = join(scratch.path, 'hero.png')

		await writer.write(target, Uint8Array.from([137, 80, 78, 71, 13]))

		expect([...readFileSync(target)]).toEqual([137, 80, 78, 71, 13])
	})

	it('creates every missing parent directory of the target path', async () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-writer-' })
		teardown.add(() => scratch.destroy())
		const writer = new FileBrowserWriter()
		const target = join(scratch.path, 'shots', 'nested', 'hero.png')

		await writer.write(target, Uint8Array.from([1, 2, 3]))

		expect([...readFileSync(target)]).toEqual([1, 2, 3])
	})

	it('replaces the previous content of an existing file', async () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-writer-' })
		teardown.add(() => scratch.destroy())
		const writer = new FileBrowserWriter()
		const target = join(scratch.path, 'hero.png')

		await writer.write(target, Uint8Array.from([1, 2, 3, 4]))
		await writer.write(target, Uint8Array.from([9]))

		expect([...readFileSync(target)]).toEqual([9])
	})

	it('writes an empty payload as an empty file', async () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-writer-' })
		teardown.add(() => scratch.destroy())
		const writer = new FileBrowserWriter()
		const target = join(scratch.path, 'empty.bin')

		await writer.write(target, new Uint8Array())

		expect([...readFileSync(target)]).toEqual([])
	})

	it('rejects when the target path names an existing directory', async () => {
		const scratch = createScratch({ prefix: 'orkestrel-browser-writer-' })
		teardown.add(() => scratch.destroy())
		const writer = new FileBrowserWriter()
		const target = scratch.ensure('occupied')

		await expect(writer.write(target, Uint8Array.from([1]))).rejects.toThrow('EISDIR')
	})
})
