import type { BrowserAction } from '@src/core'
import { BrowserError, BrowserStepError, isBrowserError, isBrowserStepError } from '@src/core'
import { describe, expect, it } from 'vitest'

describe('browser error guards', () => {
	it('recognizes numeric error context even when the refused input is not finite', () => {
		for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0]) {
			const error = new BrowserError('ARGUMENT', 'Invalid input', {
				value,
				point: { x: value, y: 0 },
				values: [value],
			})
			expect(isBrowserError(error)).toBe(true)
			expect(error.context?.['value']).toBe(value)
		}
	})

	it('reads declared callable action members without touching restricted function accessors', () => {
		const action: BrowserAction = {
			action: 'wait',
			arguments: {},
			outcome: 'done',
			receipt: 'Ready',
			elapsed: 0,
		}
		const callable = Object.defineProperties(
			() => undefined,
			Object.getOwnPropertyDescriptors(action),
		)
		Object.defineProperty(callable, 'caller', {
			get: () => {
				throw new Error('unrelated restricted accessor')
			},
		})
		const error = new BrowserStepError('s1', action)
		Object.defineProperty(error, 'action', { value: callable })
		expect(isBrowserStepError(error)).toBe(true)
	})

	it('narrows a coded browser failure and retains its JSON context', () => {
		const context = { method: 'Page.navigate', detail: { retry: false }, values: [1, null] }
		const error = new BrowserError('REMOTE', 'Remote failure', context)
		expect(isBrowserError(error)).toBe(true)
		expect(isBrowserStepError(error)).toBe(false)
		expect(error).toBeInstanceOf(Error)
		expect(error).toMatchObject({ name: 'BrowserError', code: 'REMOTE', message: 'Remote failure' })
		expect(error.context).toBe(context)
		expect(new BrowserError('CLOSED', 'Closed').context).toBeUndefined()
	})

	it('carries the incomplete action, step id, and receipt', () => {
		const action: BrowserAction = {
			action: 'wait',
			arguments: { text: 'Saved' },
			outcome: 'timeout',
			receipt: '"Saved" did not appear within 5 s.',
			elapsed: 5000,
		}
		const error = new BrowserStepError('s3', action)
		expect(error).toMatchObject({
			name: 'BrowserStepError',
			code: 'STEP',
			message: 's3: "Saved" did not appear within 5 s.',
			context: { step: 's3' },
		})
		expect(error.action).toBe(action)
		expect(isBrowserError(error)).toBe(true)
		expect(isBrowserStepError(error)).toBe(true)
		expect(isBrowserStepError(new BrowserError('STEP', error.message))).toBe(false)
		expect(isBrowserStepError(action)).toBe(false)
	})

	it('is total for revoked proxies and rejects unrelated values and lookalikes', () => {
		const revocable = Proxy.revocable({}, {})
		revocable.revoke()
		expect(isBrowserError(revocable.proxy)).toBe(false)
		expect(isBrowserStepError(revocable.proxy)).toBe(false)
		expect(isBrowserError(undefined)).toBe(false)
		expect(isBrowserStepError(null)).toBe(false)
		expect(isBrowserError(new Error('failure'))).toBe(false)
		expect(isBrowserError({ name: 'BrowserError', code: 'REMOTE', message: 'failure' })).toBe(false)
		expect(isBrowserStepError({ name: 'BrowserStepError', code: 'STEP', action: {} })).toBe(false)
	})
})
