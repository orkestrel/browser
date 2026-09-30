import { describe, expect, it } from 'vitest'
import { setup } from './setupGlobal.js'

describe('setup', () => {
	it('provides a live loopback origin and closes it on teardown', async () => {
		const provided: Array<[string, unknown]> = []
		const project = {
			provide: (key: string, value: unknown) => {
				provided.push([key, value])
			},
		}
		const teardown = await setup(project)

		expect(provided).toHaveLength(1)
		const [key, origin] = provided[0] ?? []
		expect(key).toBe('server')
		expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
		if (typeof origin !== 'string') throw new Error('origin is not a string')

		const answered = await fetch(origin + '/')
		expect(answered.status).toBe(200)
		expect(answered.headers.get('access-control-allow-origin')).toBe('*')

		await teardown()
		await expect(fetch(origin + '/')).rejects.toThrow(/fetch/i)
	})
})
