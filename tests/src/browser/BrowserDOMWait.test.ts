import { describe, expect, it } from 'vitest'
import { isBrowserElementError, isBrowserError } from '@src/core'
import { BrowserDOMWait, collectBrowserRoots } from '@src/browser'
import { createRecorder, requireValue, waitForDelay } from '@orkestrel/test'
import { createProbeDocument, createProbeElements, loadProbeFrame } from '../../setupBrowser.js'

describe('BrowserDOMWait', () => {
	it('resolves at once when the check already holds', async () => {
		const probe = createProbeDocument('<p id="ready">ready</p>')
		const found = await new BrowserDOMWait({
			roots: () => [probe],
			check: () => probe.getElementById('ready') ?? undefined,
			timeout: 0,
			start: performance.now(),
			subject: 'Ready wait',
		}).execute()
		expect(found.textContent).toBe('ready')
	})

	it('re-runs the check after a mutation and resolves its value', async () => {
		const probe = createProbeDocument('<main></main>')
		const pending = new BrowserDOMWait({
			roots: () => [probe],
			check: () => probe.getElementById('late')?.textContent ?? undefined,
			timeout: 1_000,
			start: performance.now(),
			subject: 'Late wait',
		}).execute()
		setTimeout(() => probe.body.insertAdjacentHTML('beforeend', '<p id="late">late</p>'), 10)
		expect(await pending).toBe('late')
	})

	it('disconnects its observers when it settles, so a later mutation runs no check', async () => {
		const probe = createProbeDocument('<main></main>')
		const checks = createRecorder<[]>()
		const pending = new BrowserDOMWait({
			roots: () => [probe],
			check: () => {
				checks.handler()
				return probe.getElementById('late') ?? undefined
			},
			timeout: 1_000,
			start: performance.now(),
			subject: 'Settled wait',
		}).execute()
		probe.body.insertAdjacentHTML('beforeend', '<p id="late">late</p>')
		await pending
		const settled = checks.count
		probe.body.insertAdjacentHTML('beforeend', '<p>after</p>')
		await waitForDelay(10)
		expect(checks.count).toBe(settled)
	})

	it('joins a same-origin frame inserted after the wait began and wakes on a match inside it', async () => {
		const probe = await createProbeElements()
		const pending = new BrowserDOMWait({
			roots: () => collectBrowserRoots(probe.document),
			check: () =>
				Array.from(probe.document.querySelectorAll('iframe'))
					.map((frame) => frame.contentDocument?.getElementById('inner'))
					.find((element) => element !== null && element !== undefined) ?? undefined,
			timeout: 2_000,
			start: performance.now(),
			subject: 'Frame wait',
		}).execute()
		const inner = await loadProbeFrame(probe.document, probe.late, '<main></main>')
		inner.body.insertAdjacentHTML('beforeend', '<button id="inner">Inner</button>')
		expect((await pending).textContent).toBe('Inner')
	})

	it('counts its deadline from start', async () => {
		const probe = createProbeDocument('<main></main>')
		const started = performance.now()
		const expired = await new BrowserDOMWait({
			roots: () => [probe],
			check: () => undefined,
			timeout: 1_000,
			start: started - 990,
			subject: 'Late start',
		})
			.execute()
			.catch((error: unknown) => error)
		expect(isBrowserError(expired) && expired.message).toBe('Late start timed out')
		expect(performance.now() - started).toBeLessThan(500)
	})

	it('rejects on abort with the reason and with what the check throws', async () => {
		const probe = createProbeDocument('<main></main>')
		const controller = new AbortController()
		const aborted = new BrowserDOMWait({
			roots: () => [probe],
			check: () => undefined,
			timeout: 1_000,
			start: performance.now(),
			signal: controller.signal,
			subject: 'Aborted wait',
		}).execute()
		controller.abort(new Error('stopped'))
		await expect(aborted).rejects.toThrow('stopped')
		const checks = createRecorder<[]>()
		const failing = new BrowserDOMWait({
			roots: () => [probe],
			check: () => {
				checks.handler()
				if (checks.count > 2) throw new Error('check failed')
				return undefined
			},
			timeout: 1_000,
			start: performance.now(),
			subject: 'Failing wait',
		}).execute()
		probe.body.append(probe.createElement('p'))
		await expect(failing).rejects.toThrow('check failed')
		await expect(
			new BrowserDOMWait({
				roots: () => [probe],
				check: () => true,
				timeout: 1_000,
				start: performance.now(),
				signal: AbortSignal.abort(new Error('early')),
				subject: 'Early wait',
			}).execute(),
		).rejects.toThrow('early')
	})

	it('rejects with GONE when an observed window fires pagehide', async () => {
		const probe = await createProbeElements()
		const pending = new BrowserDOMWait({
			roots: () => [probe.document],
			check: () => undefined,
			timeout: 1_000,
			start: performance.now(),
			subject: 'Unloaded wait',
		}).execute()
		requireValue(probe.frame, 'probe frame').remove()
		const refusal = await pending.catch((error: unknown) => error)
		expect(isBrowserElementError(refusal) && refusal.context).toMatchObject({ reason: 'GONE' })
	})
})
