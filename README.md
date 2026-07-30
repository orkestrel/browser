# @orkestrel/browser

A typed [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)
browser automation library for the `@orkestrel` line. The environment-agnostic
core (`src/core` — `CDPClient` speaking the CDP wire protocol over an injected
`CDPTransportInterface`, plus `BrowserContext`, `BrowserPage`, and
`BrowserFrame`, semantic locators, trusted input, network/HAR controls,
diagnostics, structured DOM snapshots, content distillation that selects a
document's article rather than its whole body text, and `BrowserCodegen`)
never touches `node:*` or the DOM; the Node runtime (`src/server`)
adapts it with a `WebSocketCDPTransport`, browser process launch/discovery
(`node:child_process` + `fetch`), a filesystem screenshot writer, and the
`Browser` façade that ties launch → context → page together. Part of the
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
import { CDPClient } from '@orkestrel/browser'
import type { CDPTransportInterface } from '@orkestrel/browser'

const transport: CDPTransportInterface = /* your injected transport */
const client = new CDPClient({ transport })
await client.connect()
const result = await client.send('Page.navigate', { url: 'https://example.com' })
```

## Guide

For the full surface — the CDP dispatch core, the `BrowserContext` /
`BrowserPage` / `BrowserCodegen` entities, the server transports, and usage
patterns — see [`guides/src/browser.md`](guides/src/browser.md).

## Package

Published with two entry points per the `exports` field in `package.json`:
the environment-agnostic core (`.`) — `CDPClient`, `BrowserContext`,
`BrowserPage`, `BrowserFrame`, DOM snapshot traversal helpers,
`BrowserCodegen`, `createCDPClient`, `CDPTransportInterface` —
and the Node-only server surface (`./server`) — `Browser`, `createBrowser`,
`createCDPTransport`, `createScreenshotWriter`, `WebSocketCDPTransport`.

## License

MIT © [Orkestrel](https://github.com/orkestrel) — see [LICENSE](./LICENSE).
