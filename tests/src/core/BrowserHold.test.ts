import { describe, expect, it } from 'vitest'
import { createRecorder } from '@orkestrel/test'
import { BrowserHold } from '@src/core'

describe('BrowserHold', () => {
	it('releases once, including reentrant destruction, and gives each hold its own token', () => {
		const released = createRecorder<[]>()
		const hold = new BrowserHold('add-kettle', released.handler)
		const other = new BrowserHold('add-kettle', released.handler)
		expect(hold.name).toBe('add-kettle')
		expect(hold.token).not.toBe(other.token)
		expect(hold.token.length).toBeGreaterThan(0)
		hold.destroy()
		hold.destroy()
		expect(released.count).toBe(1)
		other.destroy()
		expect(released.count).toBe(2)
		const recursive = new BrowserHold('checkout', () => recursive.destroy())
		expect(() => recursive.destroy()).not.toThrow()
	})
})
