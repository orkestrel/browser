import { expect, it } from 'vitest'
import { MemoryBrowserRunStore } from '@src/core'
import { describeBrowserRunStore } from './suite.js'

describeBrowserRunStore('MemoryBrowserRunStore', () => new MemoryBrowserRunStore())

it('opens no capture directory', async () => {
	expect(await new MemoryBrowserRunStore().create('add-kettle')).not.toHaveProperty('directory')
})

it('resolves capture without a name for an opened memory slot', async () => {
	const store = new MemoryBrowserRunStore()
	const slot = await store.create('add-kettle')
	await expect(store.capture(slot, 's1.png', new Uint8Array([137, 80]))).resolves.toBeUndefined()
})
