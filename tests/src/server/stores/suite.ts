import type { ChildProcess } from 'node:child_process'
import { spawn as spawnProcess, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { isRecord, parseJSON } from '@orkestrel/contract'
import { createScratch, supportsMode } from '@orkestrel/test/server'
import { waitForEvent } from '@orkestrel/test'
import { formatBrowserLockEntry, parseBrowserLockEntry } from '@src/server'
import {
	BrowserLockObserver,
	SOURCE_HOOK,
	BROWSER_LOCK_RECOVERER,
	readExitedProcessId,
	waitForBrowserChild,
	stopBrowserChild,
} from '../../../setupServer.js'
import {
	BROWSER_RUN_FIXTURE,
	createBrowserJourneyFixture,
	createBrowserViewDouble,
} from '../../../setup.js'

/**
 * Registers filesystem-only proofs for the durable journey and run stores.
 * @remarks Browser projects load the host-independent setup module, so these proofs stay server-side.
 */
export function describeFileBrowserStores(): void {
	describe('file store filesystem contracts', () => {
		it('retries a lock directory that vanishes after EEXIST and before readdir', async () => {
			const { mkdir, readdir, rmdir } = await import('node:fs/promises')
			const scratch = createScratch()
			try {
				const lock = join(scratch.path, 'journey.lock')
				await mkdir(lock)
				let checks = 0
				let vanished = false
				const files = new BrowserLockObserver({ root: scratch.path }, async (path) => {
					if (path !== lock) return
					checks += 1
					// The second check follows mkdir's EEXIST, immediately before reading the directory.
					if (checks !== 2) return
					await rmdir(lock)
					vanished = true
				})
				await expect(
					files.lock(lock, async () => 'entered'),
					'vanished directory retries acquisition',
				).resolves.toBe('entered')
				expect(vanished).toBe(true)
				expect(await readdir(scratch.path)).toEqual([])
			} finally {
				scratch.destroy()
			}
		})
		it('refuses save when a second store saved the name between record and save', async () => {
			const { FileBrowserJourneyStore } = await import('@src/server')
			const { BrowserToolset } = await import('@src/core')
			const { BrowserJourneyToolset } =
				await import('../../../../src/core/BrowserJourneyToolset.js')
			const scratch = createScratch()
			const first = new FileBrowserJourneyStore({ root: scratch.path })
			const second = new FileBrowserJourneyStore({ root: scratch.path })
			const toolset = new BrowserToolset(createBrowserViewDouble())
			const journeys = new BrowserJourneyToolset(toolset, { store: first })
			try {
				await toolset.start()
				expect(
					await toolset.tools.execute({
						id: '1',
						name: 'record',
						arguments: { journey: 'check-ready' },
					}),
				).toMatchObject({ success: true })
				const saved = await second.set(createBrowserJourneyFixture())
				await toolset.tools.execute({ id: 'wait', name: 'wait', arguments: { text: 'Ready' } })
				expect(
					await toolset.tools.execute({
						id: '2',
						name: 'save',
						arguments: { description: 'Replacement' },
					}),
				).toMatchObject({
					success: false,
					error: 'A journey named "check-ready" is saved; call journeys, or record another name.',
				})
				expect(await first.get('check-ready')).toEqual(saved)
			} finally {
				await journeys.destroy()
				await toolset.destroy()
				scratch.destroy()
			}
		})

		it('skips non-journey names without faults or hiding journeys beyond the cap', async () => {
			const { mkdir } = await import('node:fs/promises')
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const store = new FileBrowserJourneyStore({ root: scratch.path, limit: 1 })
				await mkdir(join(scratch.path, '.profiles'))
				await mkdir(join(scratch.path, 'Not-a-journey'))
				for (const name of ['alpine', 'harbor'])
					await store.set(createBrowserJourneyFixture(undefined, { name }))
				const first = await store.list()
				const next = await store.list({ offset: first.entries.length })
				expect(first.faults).toEqual([])
				expect(next.faults).toEqual([])
				expect(first.truncated).toBe(true)
				expect(next.truncated).toBe(false)
				expect([...first.entries, ...next.entries].map((entry) => entry.journey.name)).toEqual([
					'alpine',
					'harbor',
				])
			} finally {
				scratch.destroy()
			}
		})

		it('recovers a dead holder lock after refusing the live child', async () => {
			const { readdir } = await import('node:fs/promises')
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			scratch.write(
				'holder.ts',
				`
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { once } from 'node:events'
${SOURCE_HOOK}
const { FileBrowserStore } = await import(pathToFileURL(resolve('src/server/stores/FileBrowserStore.ts')).href)
const files = new FileBrowserStore({ root: process.argv[2] })
await files.lock(resolve(process.argv[2], 'check-ready', 'journey.lock'), async () => {
	process.send?.('held')
	await once(process, 'message')
})
`,
			)
			const child = spawnProcess(
				process.execPath,
				[join(scratch.path, 'holder.ts'), scratch.path],
				{ stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
			)
			try {
				const ready = await waitForEvent<[unknown]>(
					(listener) => {
						child.once('message', listener)
						return () => {
							child.off('message', listener)
						}
					},
					'child holds journey lock',
					{ budget: 10000 },
				)
				expect(ready[0]).toBe('held')
				const store = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				const lock = join(scratch.path, journey.name, 'journey.lock')
				await expect(store.set(journey)).rejects.toMatchObject({
					code: 'STORE_LOCKED',
					message: `Journey is locked: ${lock}`,
				})
				expect((await readdir(lock)).map(parseBrowserLockEntry)).toEqual([child.pid])
				const exit = waitForEvent<[number | null, NodeJS.Signals | null]>(
					(listener) => {
						child.once('exit', listener)
						return () => {
							child.off('exit', listener)
						}
					},
					'lock holder dies',
					{ budget: 10000 },
				)
				child.kill('SIGKILL')
				await exit
				expect((await store.set(journey)).revision).toBe(1)
				expect(await store.get(journey.name)).toMatchObject({ journey, revision: 1 })
				await expect(readdir(lock)).rejects.toMatchObject({ code: 'ENOENT' })
			} finally {
				if (child.exitCode === null && child.signalCode === null) {
					const exit = waitForEvent<[number | null, NodeJS.Signals | null]>(
						(listener) => {
							child.once('exit', listener)
							return () => {
								child.off('exit', listener)
							}
						},
						'terminated lock holder',
						{ budget: 10000 },
					)
					child.kill('SIGKILL')
					await exit
				}
				scratch.destroy()
			}
		}, 15000)
		it('admits exactly one of two processes that observed the same dead holder', async () => {
			const { mkdir, writeFile, readdir } = await import('node:fs/promises')
			const scratch = createScratch()
			const children: ChildProcess[] = []
			try {
				const lock = join(scratch.path, 'journey.lock')
				const dead = formatBrowserLockEntry(
					readExitedProcessId(),
					'11111111-1111-4111-8111-111111111111',
				)
				await mkdir(lock)
				await writeFile(join(lock, dead), '')
				const script = scratch.write('recover.ts', BROWSER_LOCK_RECOVERER)
				for (let index = 0; index < 2; index += 1)
					children.push(
						spawnProcess(process.execPath, [script, scratch.path, dead], {
							stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
						}),
					)
				expect(await Promise.all(children.map((child) => waitForBrowserChild(child)))).toEqual([
					'observed',
					'observed',
				])
				const [first, second] = children
				if (first === undefined || second === undefined) throw new Error('Missing recoverers')
				const entered = waitForBrowserChild(first)
				first.send('reclaim')
				expect(await entered).toBe('entered')
				const held = await readdir(lock)
				expect(held.map(parseBrowserLockEntry)).toEqual([first.pid])
				const refused = waitForBrowserChild(second)
				second.send('reclaim')
				expect(await refused, 'the second recoverer cannot enter while the first holds').toBe(
					'STORE_LOCKED',
				)
				expect(await readdir(lock), 'reclaim preserves the live winner').toEqual(held)
				const released = waitForBrowserChild(first)
				first.send('release')
				expect(await released).toBe('released')
				await expect(readdir(lock)).rejects.toMatchObject({ code: 'ENOENT' })
			} finally {
				await Promise.all(children.map((child) => stopBrowserChild(child)))
				scratch.destroy()
			}
		}, 15000)

		it('prevents competing processes from both saving the same expected revision', async () => {
			const { spawn } = await import('node:child_process')
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			const children: ChildProcess[] = []
			try {
				const store = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				await store.set(journey)
				scratch.write(
					'race.ts',
					`
import { registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
${SOURCE_HOOK}
const { FileBrowserJourneyStore } = await import(pathToFileURL(resolve('src/server/stores/FileBrowserJourneyStore.ts')).href)
const store = new FileBrowserJourneyStore({ root: process.argv[2] })
process.once('message', async (journey) => {
	try {
		const saved = await store.set(journey, { revision: 1 })
		process.send?.({ outcome: 'saved', revision: saved.revision })
	} catch (error) {
		process.send?.({ outcome: 'refused', code: error.code })
	} finally { process.disconnect?.() }
})
process.send?.({ outcome: 'ready' })
`,
				)
				for (let index = 0; index < 2; index += 1)
					children.push(
						spawn(process.execPath, [join(scratch.path, 'race.ts'), scratch.path], {
							stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
						}),
					)
				const exits = children.map((child) =>
					waitForEvent<[number | null, NodeJS.Signals | null]>(
						(listener) => {
							child.once('exit', listener)
							return () => {
								child.off('exit', listener)
							}
						},
						'file store child exits',
						{ budget: 10000 },
					),
				)
				const ready = await Promise.all(
					children.map((child) =>
						waitForEvent<[unknown]>(
							(listener) => {
								child.once('message', listener)
								return () => {
									child.off('message', listener)
								}
							},
							'file store child ready',
							{ budget: 10000 },
						),
					),
				)
				expect(ready.map((event) => event[0])).toEqual([{ outcome: 'ready' }, { outcome: 'ready' }])
				const answers = children.map((child) =>
					waitForEvent<[unknown]>(
						(listener) => {
							child.once('message', listener)
							return () => {
								child.off('message', listener)
							}
						},
						'file store child result',
						{ budget: 10000 },
					),
				)
				for (const child of children) child.send(journey)
				const results = (await Promise.all(answers)).map((event) => event[0])
				const saved = results.filter((value) => isRecord(value) && value['outcome'] === 'saved')
				expect(saved.length).toBeLessThanOrEqual(1)
				expect(saved).toEqual(saved.map(() => ({ outcome: 'saved', revision: 2 })))
				expect(
					results.filter(
						(value) =>
							isRecord(value) &&
							value['outcome'] === 'refused' &&
							['STORE_LOCKED', 'JOURNEY_STALE'].includes(String(value['code'])),
					),
				).toHaveLength(2 - saved.length)
				expect(await Promise.all(exits)).toEqual([
					[0, null],
					[0, null],
				])
				expect((await store.get(journey.name))?.revision).toBe(1 + saved.length)
				// Publication can overlap and make both holders refuse. A later uncontended
				// write must still advance exactly once, then reject the stale expectation.
				expect((await store.set(journey, { revision: 1 + saved.length })).revision).toBe(
					2 + saved.length,
				)
				await expect(store.set(journey, { revision: 1 + saved.length })).rejects.toMatchObject({
					code: 'JOURNEY_STALE',
				})
			} finally {
				for (const child of children) {
					if (child.exitCode === null && child.signalCode === null) {
						const exit = waitForEvent<[number | null, NodeJS.Signals | null]>(
							(listener) => {
								child.once('exit', listener)
								return () => {
									child.off('exit', listener)
								}
							},
							'terminated file store child',
							{ budget: 10000 },
						)
						child.kill()
						await exit
					}
				}
				scratch.destroy()
			}
		}, 15000)

		it('reopens journeys and runs from the same path', async () => {
			const { FileBrowserJourneyStore, FileBrowserRunStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const options = { root: scratch.path }
				const journeys = new FileBrowserJourneyStore(options)
				const runs = new FileBrowserRunStore(options)
				const journey = createBrowserJourneyFixture()
				const saved = await journeys.set(journey)
				const slot = await runs.create(BROWSER_RUN_FIXTURE.journey.name)
				const run = { ...BROWSER_RUN_FIXTURE, id: slot.id }
				await runs.set(run)
				expect(await new FileBrowserJourneyStore(options).get(journey.name)).toEqual(saved)
				expect(await new FileBrowserRunStore(options).get(run.journey.name, run.id)).toEqual(run)
			} finally {
				scratch.destroy()
			}
		})

		it('refuses corrupt files rather than returning absence', async () => {
			const { writeFile } = await import('node:fs/promises')
			const { FileBrowserJourneyStore, FileBrowserRunStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const journeys = new FileBrowserJourneyStore({ root: scratch.path })
				const runs = new FileBrowserRunStore({ root: scratch.path })
				const saved = await journeys.set(createBrowserJourneyFixture())
				const slot = await runs.create(BROWSER_RUN_FIXTURE.journey.name)
				const run = { ...BROWSER_RUN_FIXTURE, id: slot.id }
				await runs.set(run)
				const journeyPath = join(scratch.path, saved.journey.name, 'journey.json')
				const runPath = join(scratch.path, run.journey.name, 'runs', run.id, 'run.json')
				for (const corrupt of [
					'',
					'{',
					'{bad json}',
					'{}',
					JSON.stringify({ revision: 1, journey: {} }),
					JSON.stringify({ format: 1, journey: {} }),
				]) {
					await writeFile(journeyPath, corrupt)
					await writeFile(runPath, corrupt)
					await expect(journeys.get(saved.journey.name)).rejects.toMatchObject({
						code: 'STORE_FILE',
						message: expect.stringContaining(journeyPath),
					})
					await expect(runs.get(run.journey.name, run.id)).rejects.toMatchObject({
						code: 'STORE_FILE',
						message: expect.stringContaining(runPath),
					})
				}
				await writeFile(
					journeyPath,
					JSON.stringify({ ...saved, journey: { ...saved.journey, format: 9 } }),
				)
				await writeFile(runPath, JSON.stringify({ ...run, format: 9 }))
				await expect(journeys.get(saved.journey.name)).rejects.toMatchObject({
					code: 'STORE_FORMAT',
					message: expect.stringContaining(journeyPath),
				})
				await expect(runs.get(run.journey.name, run.id)).rejects.toMatchObject({
					code: 'STORE_FORMAT',
					message: expect.stringContaining(runPath),
				})
			} finally {
				scratch.destroy()
			}
		})

		it('reports chmod 000 permission errors from a non-root child with the denied path', async (context) => {
			context.skip(
				!supportsMode(),
				'supportsMode reports that chmod permission bits do not round-trip on this host',
			)
			const { chmod, stat } = await import('node:fs/promises')
			const { FileBrowserJourneyStore, FileBrowserRunStore } = await import('@src/server')
			const root = process.getuid?.() === 0
			const account = root
				? readFileSync('/etc/passwd', 'utf8')
						.split(/\r\n|\n/)
						.find((line) => line.startsWith('nobody:'))
						?.split(':')
				: undefined
			if (root && account === undefined) {
				context.skip('The nobody account is absent; root bypasses chmod 000 mode bits')
				return
			}
			const uid = account === undefined ? undefined : Number(account[2])
			const gid = account === undefined ? undefined : Number(account[3])
			if (
				root &&
				(uid === undefined || uid <= 0 || !Number.isSafeInteger(uid) || !Number.isSafeInteger(gid))
			)
				throw new Error('The nobody account must have a non-root uid and an integer gid')
			const scratch = createScratch()
			try {
				const journeys = new FileBrowserJourneyStore({ root: scratch.path })
				const runs = new FileBrowserRunStore({ root: scratch.path })
				const saved = await journeys.set(createBrowserJourneyFixture())
				const slot = await runs.create(BROWSER_RUN_FIXTURE.journey.name)
				await runs.set({ ...BROWSER_RUN_FIXTURE, id: slot.id })
				const paths = [
					join(scratch.path, saved.journey.name, 'journey.json'),
					join(scratch.path, BROWSER_RUN_FIXTURE.journey.name, 'runs', slot.id, 'run.json'),
				]
				// The child must reach the files so denial measures file reads, not directory traversal.
				await chmod(scratch.path, 0o755)
				await chmod(join(scratch.path, saved.journey.name), 0o755)
				await chmod(join(scratch.path, BROWSER_RUN_FIXTURE.journey.name), 0o755)
				await chmod(join(scratch.path, BROWSER_RUN_FIXTURE.journey.name, 'runs'), 0o755)
				await chmod(join(scratch.path, BROWSER_RUN_FIXTURE.journey.name, 'runs', slot.id), 0o755)
				const control = scratch.write('read-control', 'readable')
				await chmod(control, 0o644)
				const script = scratch.write(
					'access.ts',
					`
import { strict as assert } from 'node:assert'
import { readFile, stat } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
${SOURCE_HOOK}
assert.notEqual(process.getuid?.(), 0)
const { FileBrowserJourneyStore } = await import(pathToFileURL(resolve('src/server/stores/FileBrowserJourneyStore.ts')).href)
const { FileBrowserRunStore } = await import(pathToFileURL(resolve('src/server/stores/FileBrowserRunStore.ts')).href)
const [root, journey, run, id] = process.argv.slice(2)
assert.equal(await readFile(join(root, 'read-control'), 'utf8'), 'readable')
const journeys = new FileBrowserJourneyStore({ root })
const runs = new FileBrowserRunStore({ root })
for (const path of [join(root, journey, 'journey.json'), join(root, run, 'runs', id, 'run.json')]) {
	assert.equal((await stat(path)).mode & 0o777, 0)
	await assert.rejects(readFile(path), { code: 'EACCES' })
}
const outcomes = await Promise.allSettled([journeys.get(journey), runs.get(run, id)])
console.log(JSON.stringify({
	uid: process.getuid?.(), gid: process.getgid?.(),
	outcomes: outcomes.map((outcome) => outcome.status === 'rejected'
		? { status: outcome.status, code: outcome.reason.code, message: outcome.reason.message }
		: { status: outcome.status })
}))
`,
				)
				await chmod(script, 0o644)
				for (const path of paths) {
					expect(parseJSON(readFileSync(path, 'utf8'))).toBeDefined()
					await chmod(path, 0)
					expect((await stat(path)).mode & 0o777).toBe(0)
				}
				try {
					const child = spawnSync(
						process.execPath,
						[script, scratch.path, saved.journey.name, BROWSER_RUN_FIXTURE.journey.name, slot.id],
						{ uid, gid, encoding: 'utf8', timeout: 10000 },
					)
					expect(child.error).toBeUndefined()
					expect({ status: child.status, stderr: child.stderr }).toEqual({ status: 0, stderr: '' })
					expect(parseJSON(child.stdout)).toEqual({
						uid: uid ?? process.getuid?.(),
						gid: gid ?? process.getgid?.(),
						outcomes: paths.map((path) => ({
							status: 'rejected',
							code: 'STORE_ACCESS',
							message: expect.stringContaining(path),
						})),
					})
				} finally {
					for (const path of paths) await chmod(path, 0o600)
				}
			} finally {
				scratch.destroy()
			}
		})

		it('allows one exclusive creator across independent file store instances', async () => {
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const first = new FileBrowserJourneyStore({ root: scratch.path })
				const second = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				const results = await Promise.allSettled([
					first.set(journey, { exclusive: true }),
					second.set({ ...journey, description: 'Second' }, { exclusive: true }),
				])
				expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
				expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
				expect((await first.get(journey.name))?.revision).toBe(1)
				expect(await first.get(journey.name)).toEqual(await second.get(journey.name))
			} finally {
				scratch.destroy()
			}
		})
		it('refuses a lost update across instances and preserves revisions after deletion', async () => {
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const first = new FileBrowserJourneyStore({ root: scratch.path })
				const second = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				await first.set(journey)
				const outcomes = await Promise.allSettled([
					first.set({ ...journey, description: 'First' }, { revision: 1 }),
					second.set({ ...journey, description: 'Second' }, { revision: 1 }),
				])
				expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
				expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
				expect((await first.get(journey.name))?.revision).toBe(2)
				await second.delete(journey.name)
				await expect(first.set(journey, { revision: 2 })).rejects.toMatchObject({
					code: 'JOURNEY_STALE',
				})
				expect((await second.set(journey)).revision).toBe(3)
				await expect(first.set(journey, { revision: 2 })).rejects.toMatchObject({
					code: 'JOURNEY_STALE',
				})
			} finally {
				scratch.destroy()
			}
		})

		it('refuses a held lock before reading the expected revision', async () => {
			const { mkdir, writeFile, unlink, rmdir } = await import('node:fs/promises')
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const store = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				await store.set(journey)
				const lock = join(scratch.path, journey.name, 'journey.lock')
				await mkdir(lock)
				const entry = join(
					lock,
					formatBrowserLockEntry(process.pid, '11111111-1111-4111-8111-111111111111'),
				)
				await writeFile(entry, '')
				await expect(store.set(journey, { exclusive: true })).rejects.toMatchObject({
					code: 'STORE_LOCKED',
				})
				await expect(store.delete(journey.name)).rejects.toMatchObject({
					code: 'STORE_LOCKED',
				})
				await unlink(entry)
				await rmdir(lock)
				expect((await store.set(journey, { revision: 1 })).revision).toBe(2)
			} finally {
				scratch.destroy()
			}
		})

		it('keeps the previous revision and removes temporary files after a failed write', async () => {
			const { mkdir, unlink, readdir } = await import('node:fs/promises')
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const store = new FileBrowserJourneyStore({ root: scratch.path })
				const journey = createBrowserJourneyFixture()
				const saved = await store.set(journey)
				const revision = join(scratch.path, journey.name, 'revision')
				// A real directory at the counter path refuses the replacement before any data is lost.
				await unlink(revision)
				await mkdir(revision)
				await expect(
					store.set({ ...journey, description: 'Uncommitted' }, { revision: 1 }),
				).rejects.toMatchObject({ code: 'STORE_FILE' })
				expect(await store.get(journey.name)).toEqual(saved)
				expect((await readdir(join(scratch.path, journey.name))).sort()).toEqual([
					'journey.json',
					'revision',
				])
			} finally {
				scratch.destroy()
			}
		})

		it('pages sorted readable journeys with a cap, truncation, and faults', async () => {
			const { writeFile } = await import('node:fs/promises')
			const { FileBrowserJourneyStore } = await import('@src/server')
			const scratch = createScratch()
			try {
				const store = new FileBrowserJourneyStore({ root: scratch.path, limit: 1 })
				for (const name of ['zebra', 'broken', 'alpine', 'harbor'])
					await store.set(createBrowserJourneyFixture(undefined, { name }))
				await writeFile(join(scratch.path, 'broken', 'journey.json'), '{')
				const first = await store.list({ limit: 999 })
				expect(first.entries.map((entry) => entry.journey.name)).toEqual(['alpine'])
				expect(first.truncated).toBe(true)
				expect(first.faults).toEqual([{ name: 'broken', reason: 'Malformed journey revision' }])
				const next = await store.list({ offset: 1 })
				expect(next.entries.map((entry) => entry.journey.name)).toEqual(['harbor'])
				expect(next.truncated).toBe(true)
				expect((await store.list({ offset: 2 })).truncated).toBe(false)
			} finally {
				scratch.destroy()
			}
		})

		it('refuses reserved and escaping names before filesystem access', async () => {
			const { FileBrowserJourneyStore, FileBrowserRunStore } = await import('@src/server')
			const scratch = createScratch()
			const journeys = new FileBrowserJourneyStore({ root: scratch.path })
			const runs = new FileBrowserRunStore({ root: scratch.path })
			scratch.destroy()
			for (const name of ['con', 'aux', 'com1', 'lpt9', '../escape', 'two/parts', 'UPPER']) {
				await expect(journeys.get(name)).rejects.toMatchObject({ code: 'STORE_PATH' })
				await expect(journeys.set(createBrowserJourneyFixture([], { name }))).rejects.toMatchObject(
					{ code: 'STORE_PATH' },
				)
				await expect(journeys.delete(name)).rejects.toMatchObject({ code: 'STORE_PATH' })
				await expect(runs.create(name)).rejects.toMatchObject({ code: 'STORE_PATH' })
			}
		})
	})
}
