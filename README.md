# @orkestrel/browser

> A Chrome DevTools Protocol automation layer for Chromium-family browsers: an
> environment-agnostic core that drives pages, elements, and readings over an injected transport
> and publishes them as agent tools, an in-page face that drives a DOM document with native APIs,
> and a Node runtime that finds, launches, and connects to the browser itself.

Connect to a running browser or launch one with the `createBrowser` function, open a page, and drive it through stable element references and trusted input. Read the page as Markdown in bounded slices, and hand the whole vocabulary to an agent as `@orkestrel/tool` tools with `createBrowserToolset`. Inside a page, `createDocumentToolset` drives a DOM document with native APIs, and `createSocketCDPTransport` carries the core client over the browser's own `WebSocket`. Part of the `@orkestrel` line.

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
reading.markdown({ limit: 4_000 }) // { text, offset, total }
await page.screenshot({ path: 'example.png' })
await browser.destroy()
```

The following fence publishes the same page to an agent as tools.

```ts
import { createBrowserToolset } from '@orkestrel/browser'
import { createToolManager } from '@orkestrel/tool'

const toolset = createBrowserToolset(page, { tools: createToolManager() })
await toolset.start()
await toolset.tools.execute({ id: '1', name: 'look', arguments: { what: 'the form' } })
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

## Guide

For the full surface of the three faces, the method tables, the toolset vocabulary, the relation to WebMCP, and the contract, see [`guides/browser.md`](guides/browser.md).

## Package

The `exports` field in `package.json` names three entry points:

- `.`, the environment-agnostic core: `CDPClient`, `BrowserContext`, `BrowserPage`, `BrowserFrame`, `BrowserNavigationManager`, the element managers, `BrowserPageElement`, `BrowserReading`, `BrowserToolset`, `BrowserSnapshot`, `BrowserCodegen`, and the factories `createCDPClient`, `createBrowserReading`, `createBrowserSnapshot`, and `createBrowserToolset`;
- `./browser`, the in-page face: `BrowserDOMView`, `BrowserDOMElement`, `BrowserDOMElementManager`, `SocketCDPTransport`, and the factories `createBrowserDOMView`, `createDocumentToolset`, and `createSocketCDPTransport`;
- `./server`, the Node runtime: `Browser`, `WebSocketCDPTransport`, `FileBrowserWriter`, and the factories `createBrowser`, `createCDPTransport`, and `createBrowserWriter`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
