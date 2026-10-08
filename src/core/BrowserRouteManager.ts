import type {
	BrowserRouteDefinition,
	BrowserRouteHandler,
	BrowserRouteManagerInterface,
	BrowserRouteQuery,
} from './types.js'

/** Manages the routes owned by a page network and synchronizes its Fetch configuration. */
export class BrowserRouteManager implements BrowserRouteManagerInterface {
	readonly #definitions: BrowserRouteDefinition[]
	readonly #start: () => Promise<void>
	readonly #configure: () => Promise<void>

	constructor(
		definitions: BrowserRouteDefinition[],
		start: () => Promise<void>,
		configure: () => Promise<void>,
	) {
		this.#definitions = definitions
		this.#start = start
		this.#configure = configure
	}

	async add(query: BrowserRouteQuery, handler: BrowserRouteHandler): Promise<void> {
		await this.#start()
		const definition = { query: { ...query }, handler }
		this.#definitions.push(definition)
		try {
			await this.#configure()
		} catch (error) {
			const index = this.#definitions.indexOf(definition)
			if (index !== -1) this.#definitions.splice(index, 1)
			throw error
		}
	}

	async remove(handler: BrowserRouteHandler): Promise<void> {
		for (let index = this.#definitions.length - 1; index >= 0; index -= 1) {
			if (this.#definitions[index]?.handler === handler) this.#definitions.splice(index, 1)
		}
		await this.#configure()
	}

	async clear(): Promise<void> {
		this.#definitions.length = 0
		await this.#configure()
	}
}
