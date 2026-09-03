import type { BrowserWriterInterface } from '@src/core'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// === FileBrowserWriter

/**
 * Persists captured browser bytes to the filesystem through `node:fs/promises`.
 *
 * @remarks
 * Creates every missing parent directory of the target path before writing, so
 * a caller may name a nested destination that does not exist yet.
 *
 * @example
 * ```ts
 * import { FileBrowserWriter } from '@orkestrel/browser/server'
 *
 * const writer = new FileBrowserWriter()
 * await writer.write('shots/hero.png', new Uint8Array([137, 80, 78, 71]))
 * ```
 */
export class FileBrowserWriter implements BrowserWriterInterface {
	/**
	 * Writes the captured bytes to a path, creating its parent directories.
	 *
	 * @param path - Destination file path
	 * @param data - Captured bytes to persist
	 * @returns A promise resolving once the bytes are on disk
	 */
	async write(path: string, data: Uint8Array): Promise<void> {
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, data)
	}
}
