# Proposal — the reading arm

> A proposal nobody has ruled on yet. It is deleted after the work lands or the proposal is
> refused, and the ruling goes in the commit that removes it.

Make this package the reading arm of an agent: hold the page's HTML as a parsed tree it can query,
bound what it hands back, and offer an optional Markdown projection so a model reads a page without
spending tokens on markup.

## The goal, in the owner's words

> I even have the browser package which is like a focused cdp only version of playwright that I
> want to improve for agents to use, i feel like it needs to be the right arm for an agent, it
> needs to hold the html ast, parsing it for use within itself and making it manageable for the
> agent, even going as far as bringing in the markdown package and making it optional to have the
> html filtered and converted to markdown to save on token and making it easier for the agent to
> read. I feel like the browser might be a separate idea, but I need to make sure of the tool and
> mcp package first and if we can ground those first and solidify what I am looking for them let's
> use our experience from that to improve browser as described.

One new dependency edge is authorized and no other: `@orkestrel/markdown` into this package. Every
other rule against adding a package stands.

## Where this package stands today

`content()` returns `{ url, title, html, text }` as strings. `article()` is
`renderText(createHTML(html).distill().document)` and is the only use of `@orkestrel/html` here.
`page.snapshot()` returns a `DOMSnapshot` tree of `BrowserNode`, which is a CDP structure rather
than an HTML one. There is `BrowserAccessibility.snapshot()`, there are locators, there is no
`src/browser` environment, and the service tests launch a real Chromium through `src/server`.

## Two shapes to choose between

**Frame methods.** Add nothing that re-wraps `@orkestrel/html`. Give `BrowserFrameInterface` two
siblings beside `content()` and `article()`: `tree()` returning the frame's current HTML as html's
own handle, so the querying vocabulary a reader already knows stays the one they use, and
`markdown(options?)` composing `createHTML`, an optional `distill()`, and the Markdown render, with
options carrying a `distill` switch and a `limit` counted in characters. This package counts no
tokens and adds no tokenizer.

**A reading manager.** A `page.reading` manager whose `capture()` retains a handle from a bounded
page capture, with a readonly document, separate text and Markdown projections, `clear()` releasing
the capture, and a grouped limit over bytes, nodes, depth, and tokens — where a token ceiling must
name the function that measures it, because a character length is not a token count. Keep
`BrowserSnapshot` separate, since its CDP nodes are not HTML nodes.

The second shape names open decisions the first does not: navigation invalidation, frame ownership,
capture consistency, truncation reporting, and whether `article()` shares the implementation. It
also carries the risk note worth keeping: html's parser is not an HTML5 DOM constructor, its
hidden-content filtering does not inspect computed style, and a Markdown projection loses
information, so this work needs measured bounds and explicit freshness semantics.

## The questions a design round must answer

1. Ownership and shape: frame methods, a reading manager, or a third option, and which passes the
   test that a wrapper must add a boundary, an invariant, a composition, a translation, a
   lifecycle, or a materially narrower contract.
2. The tree: how the HTML is captured, whether it is retained or parsed per call, how it is
   invalidated on navigation without polling, and what releases it.
3. Manageability: the bound's shape, whether truncation is reported on the result, whether
   `distill` is a switch or a projection, and whether sanitizing is the default.
4. Markdown: the projection path, the option shape, and whether `article()` becomes a projection of
   the same capture.
5. Agent tools: which tools the arm ships and where they live, their contract shapes and
   annotations, how each observes its execution signal, and whether this package exposes an MCP
   server over a session or leaves that to a consumer.
6. Snapshot against tree: separate, or bridged with a locator-to-node mapping.
7. Tests: where the real-Chromium proofs live and what each proves.
8. Blast radius: the Markdown edge, this package's bump, the guide sections, and the consumers that
   re-pin. `@orkestrel/ollama` is the known consumer, holding this package as a development
   dependency for its page proof.

## What binds the answer

- **No polling.** A retained tree is invalidated by a navigation event or an explicit release,
  never by a poll.
- **Absence is `undefined`**, members are single words, class fields are `#`-private, and public
  interface properties are readonly. A shared mutable record stays a private structural type rather
  than becoming a published interface.
- **Reuse before wrapping.** A member that forwards one-to-one to `@orkestrel/html` fails the
  wrapper test; hand out html's own handle instead.
- **A host fact is never an unconditional assertion.** Assert the relationship that holds on any
  host, and let a real-Chromium proof read the host at run time.
- **Fleet name ownership.** A new bare export here must not collide with another package's guide
  surface; the vendored `surface` policy rule checks every hosted guide once this package re-pins.
- **Bench limits.** A sandboxed bench cannot launch Chromium or install a package, so the
  real-Chromium implementation and its proofs belong to a native implementer, and the objective
  lane takes design and read-only audits.
- **Versions.** `@orkestrel/html` and `@orkestrel/markdown` do not bump for the design. This package
  bumps when it implements, because a runtime edge on Markdown moves its published surface, and
  `@orkestrel/ollama` re-pins afterwards.

## What the 2026-09-15 campaign settled that this work should build on

That campaign grounded `@orkestrel/tool` and `@orkestrel/mcp` first, which is the sequencing the
owner asked for, and it left four things this work can stand on.

- **A tool carries an execution context.** `ToolContext` gives a handler a signal and an optional
  caller identity, so a page read can be cancelled, and annotations let a read declare itself pure
  while a click declares itself consequential. A page read that ignores its signal is exactly the
  leak the first shape warned about.
- **A page can host an MCP server.** `createPageServer` binds a server to a page over a message
  channel and returns a client bound but not connected, with a stop that refuses every later
  session-bound request. That is the delivery shape for browser-side tools.
- **An agent tool loop runs in a real page.** `@orkestrel/ollama`'s page proof drives a real browser
  through this package's CDP client against a live daemon, with a bounded attempt and a signal that
  cancels discovery, the port check, the launch, and the connection. It is the working example a
  "read this page" tool's proof can follow.
- **There is a reference for demand-driven streaming.** If the reading arm ever streams page
  content, mcp's subscription work is the pattern: pull on demand, deliver what was queued before a
  terminal, coalesce payload-free notifications, and release with a reason.

## How to start

Run a design round rather than an implementation unit: a subjective lane and an objective lane,
blind, on one brief built from the two shapes and the questions here, reconciled into units, an
exit criterion, and a routing ledger. Confirm first that the packages this depends on are published
and that this checkout's release visit against the current scaffold is green.
