# Guides

A dual-axis index into this repository's guides — by concept, and by directory (AGENTS §22).

## By concept

| Concept | Spec                       | Source                                                   | Tests                                                                            |
| ------- | -------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Browser | [`browser.md`](browser.md) | [`src/core`](../src/core), [`src/server`](../src/server) | [`tests/src/core`](../tests/src/core), [`tests/src/server`](../tests/src/server) |

## By directory

| Directory    | Guide                      |
| ------------ | -------------------------- |
| `src/core`   | [`browser.md`](browser.md) |
| `src/server` | [`browser.md`](browser.md) |

## Dependency reference

[`emitter.md`](emitter.md) is a byte-identical mirror of the guide
for `@orkestrel/emitter` — a runtime dependency, the typed push-observation
surface every observable entity in this package exposes as `emitter`
(`CDPClient`'s transport, `BrowserCodegen`, `Browser`). It documents **that
package's** surface, not anything sourced in this repo; it is kept here so a
reader of this package can see the primitive it is built from without
leaving this guide set.

[`contract.md`](contract.md) is a byte-identical mirror of the guide
for `@orkestrel/contract` — a runtime dependency, the `Guard<T>` vocabulary
(`isString`, `isRecord`, …) the CDP wire-boundary decoding in this package is
built from (no `as` anywhere on the CDP message boundary). It documents
**that package's** surface, not anything sourced in this repo; it is kept
here for the same reason.

[`html.md`](html.md) is a byte-identical mirror of the guide for
`@orkestrel/html` — a runtime dependency, the parse → `distill` →
`renderText` pipeline `BrowserFrameInterface.article()` is built from (the
reader-facing prose of a page, extracted from the frame's own HTML
capture). It documents **that package's** surface, not anything sourced in
this repo; it is kept here for the same reason.

[`guide.md`](guide.md) is a byte-identical mirror of the guide for
`@orkestrel/guide` — the devDependency powering this repo's guides-parity
test suite (`tests/guides.test.ts`). It documents **that
package's** surface (`Guide` / `Source`, the manifest and comparison
helpers), not anything sourced in this repo; it is kept here so a reader of
the parity suite can see the primitives it is built from without leaving
this guide set.

[`scaffold.md`](scaffold.md) is a byte-identical mirror of the guide
for `@orkestrel/scaffold` — the devDependency behind this repo's
`npm run scaffold` command, the `Blueprint` → `Plan` → `Artifact` projection
this workspace's layout is compiled from and whose `Sync` is what keeps the
mirrors in this section current. It documents **that package's** surface, not
anything sourced in this repo; it is kept here so a reader of this workspace's
shape can see the tool that produced it without leaving this guide set.

[`websocket.md`](websocket.md) is a byte-identical mirror of the guide
for `@orkestrel/websocket` — a runtime dependency, the `NodeWebSocketInterface`
transport primitive `WebSocketCDPTransport` is built from (the dumb text pipe
a CDP client sends and receives JSON-RPC frames over). It documents **that
package's** surface, not anything sourced in this repo; it is kept here for
the same reason.

## See also

- [`AGENTS.md`](../AGENTS.md) — the rules; §22 documentation-as-contracts.
