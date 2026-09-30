import type { TestProject } from 'vitest/node'
import { createServer } from 'node:http'

declare module 'vitest' {
	interface ProvidedContext {
		/** The static fixture server's loopback origin. */
		readonly server: string
	}
}

/**
 * Starts a loopback fixture server before Chromium receives the browser test graph.
 *
 * @param project - The Vitest project receiving the fixture origin
 * @returns A teardown that closes the server
 */
export async function setup(project: Pick<TestProject, 'provide'>): Promise<() => Promise<void>> {
	const server = createServer((_request, response) => {
		response.setHeader('access-control-allow-origin', '*')
		response.setHeader('content-type', 'text/html; charset=utf-8')
		response.end('<!doctype html><title>fixture</title>')
	})
	await new Promise<void>((done, fail) => {
		server.once('error', fail)
		server.listen(0, '127.0.0.1', done)
	})
	const address = server.address()
	if (address === null || typeof address === 'string') throw new Error('fixture server has no port')
	const { port } = address
	project.provide('server', `http://127.0.0.1:${port}`)
	return () =>
		new Promise<void>((done, fail) => {
			server.close((error) => (error === undefined ? done() : fail(error)))
		})
}
