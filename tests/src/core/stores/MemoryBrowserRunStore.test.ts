import { expect, it } from 'vitest'
import { MemoryBrowserRunStore } from '@src/core'
import { describeBrowserRunStore } from '../../../setup.js'

describeBrowserRunStore('MemoryBrowserRunStore', () => new MemoryBrowserRunStore())

it('opens no capture directory', async () => {
	expect(await new MemoryBrowserRunStore().open('add-kettle')).not.toHaveProperty('directory')
})
