import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createBrowser } from '@src/server'
import { readEvaluationResult } from '@src/core'
import { isRecord } from '@orkestrel/contract'
import { createScratch } from '@orkestrel/test/server'
import { requireSystemBrowser, SERVICE_BROWSER_ARGS } from '../setupService.js'
import { reservePort } from '../setupServer.js'

it('keeps account sync disabled and the launched profile free of account extensions', async () => {
	const profile = createScratch({ prefix: 'orkestrel-browser-sync-' })
	const browser = createBrowser({
		executable: requireSystemBrowser().executable,
		headless: true,
		profile: profile.path,
		args: SERVICE_BROWSER_ARGS,
		cdp: { port: await reservePort(), discover: false },
	})
	try {
		await browser.connect()
		const page = await browser.create({ url: 'chrome://sync-internals/' })
		// The native diagnostic distinguishes an absent sync service from an idle one,
		// so this proof needs no wait for an account's extension-install window.
		const status = readEvaluationResult(
			await page.send('Runtime.evaluate', {
				expression:
					'new Promise(resolve => { cr.webUIListenerCallback = (name, value) => { if (name === "onAboutInfoUpdated") resolve(value.details.flatMap(section => section.data).find(row => row.stat_name === "Transport State")?.stat_value) }; chrome.send("requestDataAndRegisterForUpdates") })',
				awaitPromise: true,
				returnByValue: true,
			}),
		)
		expect(status).toBe('Sync service does not exist')
		await browser.close()
		for (const file of ['Preferences', 'Secure Preferences']) {
			const value: unknown = JSON.parse(readFileSync(join(profile.path, 'Default', file), 'utf8'))
			if (!isRecord(value)) throw new Error(`Invalid profile ${file}`)
			expect(isRecord(value['sync']) && value['sync']['has_setup_completed']).not.toBe(true)
			if (!isRecord(value['extensions'])) continue
			const settings = value['extensions']['settings']
			if (!isRecord(settings)) continue
			// Permission-only entries aren't installs. Components and bundled defaults
			// belong to the browser even when account sync is off.
			for (const extension of Object.values(settings)) {
				if (!isRecord(extension)) throw new Error('Invalid extension preferences')
				if (!isRecord(extension['manifest'])) continue
				expect(
					extension['location'] === 5 ||
						extension['location'] === 10 ||
						extension['was_installed_by_default'] === true,
				).toBe(true)
			}
		}
	} finally {
		await browser.destroy()
		profile.destroy()
	}
})
