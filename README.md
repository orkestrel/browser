# @orkestrel/browser

> A lightweight Chrome DevTools Protocol automation layer for Chromium-family
> browsers: an environment-agnostic core that drives pages, frames, locators, and
> DOM snapshots over an injected transport, and a Node runtime that finds,
> launches, and connects to the browser itself.

Connect to a running browser or launch one with the `createBrowser` function, open a page in its
default context, and drive that page through locators, trusted input, network control, and DOM
snapshots. Inject your own `CDPTransportInterface` where the runtime is not Node. Part of the
`@orkestrel` line.

## Install

```sh
npm install @orkestrel/browser
```

## Requirements

- Node.js >= 22 for the server surface (the core surface is environment-agnostic)
- ESM and CommonJS builds ship for both the core and server entry points

## Usage

Launch or connect to a browser and drive a page from Node:

```ts
import { createBrowser } from '@orkestrel/browser/server'

const browser = createBrowser()
await browser.connect()
const page = await browser.create({ url: 'https://example.com' })
await page.click('#submit')
const frame = await page.frame('checkout')
await frame?.fill('[name=email]', 'ada@example.com')
const snapshot = await page.snapshot({ styles: ['display'] })
const article = await page.article() // reader-facing prose, boilerplate pruned
await page.screenshot({ path: 'example.png' })
await browser.destroy()
```

Drive the same protocol from any environment by injecting your own transport
over the environment-agnostic core:

```ts
import { createCDPClient } from '@orkestrel/browser'

const client = createCDPClient({ transport }) // transport: CDPTransportInterface
await client.connect()
const result = await client.send('Page.navigate', { url: 'https://example.com' })
await client.close()
```

## Guide

For the full surface — the CDP dispatch core, the `BrowserContext`,
`BrowserPage`, and `BrowserCodegen` classes, the server transports, and usage
patterns — see [`guides/browser.md`](guides/browser.md).

## Package

Published with the entry points the `exports` field in `package.json` names:
the environment-agnostic core (`.`) — `CDPClient`, `BrowserContext`,
`BrowserPage`, `BrowserFrame`, DOM snapshot traversal helpers,
`BrowserCodegen`, `createCDPClient`, `CDPTransportInterface` —
and the Node-only server surface (`./server`) — `Browser`, `createBrowser`,
`createCDPTransport`, `createBrowserWriter`, `WebSocketCDPTransport`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
