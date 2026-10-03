# @orkestrel/browser

> A Chrome DevTools Protocol automation layer for Chromium-family browsers: an
> environment-agnostic core that drives pages, elements, and readings over an injected transport
> and publishes them as agent tools, an in-page face that drives a DOM document with native APIs,
> and a Node runtime that finds, launches, and connects to the browser itself.

Connect to a running browser or launch one with the `createBrowser` function, open a page, and drive it through stable element references and trusted input. Read the whole captured page as Markdown or plain text in bounded slices, and hand the whole vocabulary to an agent as `@orkestrel/tool` tools with `createBrowserToolset`. Inside a page, `createDocumentToolset` drives a DOM document with native APIs, and `createSocketCDPTransport` carries the core client over the browser's own `WebSocket`. Record a journey, one user intent kept as JSON, from a model's tool calls or a person's gestures on a page, then list, edit, replay, and forget it through the six journey tools, or compile it with `compileBrowserJourney` into a module a developer runs and customizes. Part of the `@orkestrel` line.

## Install

```sh
npm install @orkestrel/browser
```

## Requirements

The package runs under the following conditions.

- Node.js 22.12.0 or later for the server face; the core runs in any JavaScript environment, and the browser face in a page, a worker, or an extension page.
- A Chromium-family browser on the host for the server face: Chrome, Chromium, or Microsoft Edge. The package downloads no browser.
- For `createSocketCDPTransport`, a browser launched with `--remote-allow-origins` naming the caller's origin; the browser refuses the handshake otherwise.
- For `page.registry`, a browser that exposes the experimental `WebMCP` protocol domain. The configuration reference of Chrome DevTools MCP 1.10.1, read on 2026-09-29, states that its WebMCP tools need Chrome 150 or later launched with `--enable-features=WebMCP`; see [the Chrome DevTools MCP configuration reference](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md). Chromium 141 answers `WebMCP.enable` with `-32601`, and `registry.start()` resolves `false` there.
- ESM and CommonJS builds ship for the core and server entry points, and an ESM build for the browser entry point.

## Usage

The following fence launches or connects to a browser and drives a page from Node.

```ts
import { createBrowser } from '@orkestrel/browser/server'

const browser = createBrowser({ headless: true })
await browser.connect()
const page = await browser.create({ url: 'https://example.com' })
const outline = await page.elements.outline() // the page's text and elements, with references such as e4
const [email] = await page.elements.find({ role: 'textbox', name: 'Email' })
await email?.fill('sam@example.test')
const [save] = await page.elements.find({ role: 'button', name: 'Save' })
await save?.click()
await page.wait('Saved')
const reading = await page.read()
reading.markdown({ limit: 4_000 }) // { text, offset, total }; whole page by default
reading.text({ distill: true }) // main content as plain text
await page.screenshot({ path: 'example.png' })
await browser.destroy()
```

The following fence publishes the same page to an agent as tools.

```ts
import { createBrowserToolset } from '@orkestrel/browser'
import { createToolManager } from '@orkestrel/tool'

const toolset = createBrowserToolset(page, { tools: createToolManager() })
await toolset.start()
await toolset.tools.execute({ id: '1', name: 'look', arguments: { search: 'the form' } })
await toolset.tools.execute({ id: '2', name: 'read', arguments: { search: 'delivery' } })
await toolset.tools.execute({ id: '3', name: 'plain', arguments: { search: 'confirmation' } })
await toolset.destroy()
```

The following fence drives the same protocol from any environment over a transport you inject.

```ts
import { createCDPClient } from '@orkestrel/browser'

const client = createCDPClient({ transport }) // transport: CDPTransportInterface
await client.connect()
const result = await client.send('Page.navigate', { url: 'https://example.com' })
await client.close()
```

## Browse binary

The package ships the `browse` binary, which serves the browser vocabulary and the journey tools over MCP on stdio and launches Chromium on the first tool call, keeping journeys and runs under `tmp/browsers`. Register it for a checkout with `claude mcp add --scope project browse -- node node_modules/@orkestrel/browser/dist/bin/main.js`, which writes the `browse` entry of the project's `.mcp.json`, then start `claude` in the checkout and approve the server; `BROWSE_ROOT`, `BROWSE_HEADLESS`, `BROWSE_EXECUTABLE`, and `BROWSE_READONLY` configure it. See [Register the browse binary with Claude Code](guides/browser.md#register-the-browse-binary-with-claude-code) for the entry, the approval, and a recorded exchange.

## Guide

For the full surface of the three faces, the method tables, the toolset vocabulary, the journeys, the relation to WebMCP, and the contract, see [`guides/browser.md`](guides/browser.md).

## Package

The `exports` field in `package.json` names three entry points:

- `.`, the environment-agnostic core: `CDPClient`, `BrowserContext`, `BrowserPage`, `BrowserFrame`, `BrowserNavigationManager`, the element managers, `BrowserPageElement`, `BrowserReading`, `BrowserToolset`, `BrowserSnapshot`, `BrowserCodegen`, `BrowserRecorder`, `BrowserReplay`, `BrowserJourneyToolset`, the memory journey and run stores, `compileBrowserJourney`, and the factories `createCDPClient`, `createBrowserReading`, `createBrowserSnapshot`, `createBrowserToolset`, `createBrowserRecorder`, `createBrowserReplay`, `createMemoryBrowserJourneyStore`, and `createMemoryBrowserRunStore`;
- `./browser`, the in-page face: `BrowserDOMView`, `BrowserDOMElement`, `BrowserDOMElementManager`, `SocketCDPTransport`, and the factories `createBrowserDOMView`, `createDocumentToolset`, and `createSocketCDPTransport`;
- `./server`, the Node runtime: `Browser`, `WebSocketCDPTransport`, `FileBrowserWriter`, the file journey and run stores, `BrowserMCPServer`, and the factories `createBrowser`, `createCDPTransport`, `createBrowserWriter`, `createFileBrowserJourneyStore`, `createFileBrowserRunStore`, and `createBrowserMCPServer`.

The `bin` field names `browse`, which runs `dist/bin/main.js`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
