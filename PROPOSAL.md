# Record: the browser snapshot traversal family promoted to a `BrowserSnapshot` entity, and the future `browser → html` edge

## Status

**Part 1 — shipped in this campaign (browser 0.0.8).** The traversal family is now the
`BrowserSnapshot` entity in `@orkestrel/browser` core, landed with no new
dependency. What follows is the record of that change — the fold map from the old
exports to the shipped surface, the decisions taken along the way, and how the
risks actually resolved.

**Part 2 — deferred, unchanged.** The `browser → html` dependency edge stays gated
on demonstrated demand and must not be built speculatively. Its section below
records the reconciled decisions from the `@orkestrel/html` package build so the
next campaign starts from evidence rather than memory.

**Revised after `@orkestrel/html@0.0.1` shipped.** Part 2 changed materially:
`@orkestrel/html` no longer renders markdown at all. Its markdown projection was
removed so that `@orkestrel/markdown` could be rebuilt on top of it, which
invalidates the pipeline this document originally proposed and changes how many
dependency edges each candidate convenience costs. That correction is below rather
than left to be rediscovered.

## Context and motivation

`src/core/helpers.ts` had grown a large family of free functions that all took a
decoded snapshot (and usually a `BrowserNode`) and read the flattened CDP
DOM-snapshot tree: walk, find, filter, children, parent, siblings, ancestors,
descendants, closest, document, path, distance. Twenty-three of them navigated or
queried one shape; one — `decodeBrowserSnapshot` — produced it.

This is exactly the pattern `.claude/rules/names.md` calls out:

> When a helper family grows around one shape, promote it to a class with
> entity-scoped one-word methods.

Separately, the `@orkestrel/html` build raised a recurring question — "should the
browser snapshot traversal live in, or depend on, `@orkestrel/html`?" — that
deserves a written, verifiable answer so it is not re-litigated per campaign.

---

## Part 1 — The traversal family, promoted to a `BrowserSnapshot` entity (SHIPPED)

### Why it was promoted: only the producer had a production caller

Across `src/`, the **only** call site of any function in this family was
`decodeBrowserSnapshot`, imported by `BrowserPage` and called once in
`BrowserPage.snapshot()`. The other twenty-three functions had **no production
caller** — their only consumers were the helper tests and the guide example.

That asymmetry was the whole diagnosis. `decodeBrowserSnapshot` was a real
production leaf feeding `snapshot()`. The traversal set was a public, well-tested,
but consumer-less **library surface** — roughly twenty free functions that a caller
had to import individually and thread `snapshot` through by hand. `names.md` says
to promote at precisely that point, and that is what shipped.

### What shipped

`BrowserSnapshot` is one class in its own file. Its two public own readonly members
— `documents` and `styles` — are shallow-frozen copies of the input arrays, so a
caller's array can no longer mutate a constructed snapshot while every
`BrowserDocument` and `BrowserNode` keeps its reference identity. The plain-data
type is `BrowserSnapshotInput`; the behavioral contract is
`BrowserSnapshotInterface extends BrowserSnapshotInput`, adding exactly thirteen
one-word methods: `walk`, `descendants`, `document`, `children`, `parent`,
`siblings`, `ancestors`, `common`, `distance`, `find`, `filter`, `closest`, `path`.
`walk` takes one options object (`{ root?, order?: 'depth' | 'breadth' }`),
`siblings` takes an optional `'preceding' | 'following'` relation, and
`find`/`filter`/`closest` accept a `BrowserNodeQuery` or a predicate.
`createBrowserSnapshot(input)` builds one from typed input — the only shape it
accepts — and `BrowserPage.snapshot()` returns `Promise<BrowserSnapshotInterface>`.
Four node-only leaves stayed exported and unit-tested: `decodeBrowserSnapshot`,
`matchesBrowserNode`, `isBrowserNodeVisible`, and `attributeOfBrowserNode`. Nodes
remain plain serializable data — passed in as arguments, handed back unwrapped,
never wrapped in a cursor.

### Decisions taken

- **No rooted `find`.** A `find(root, query)` overload was argued for and rejected:
  it had zero callers, and `descendants` composed with the retained matcher already
  answers it. Minimal public API won.
- **No containment predicate.** Containment is derivable — `ancestors(node)`
  already answers "is this below that" — so the old predicate was dropped rather
  than folded into a method that would restate an existing fact.
- **`common`, not `ancestor`.** The nearest-common-ancestor method kept the name
  `common` because `ancestor` reads as an accessor and would collide in meaning
  with the `ancestors` collection beside it.
- **One options object on `walk`, not two optional positionals.** Two positionals
  force `walk(undefined, 'breadth')` on the common case of "whole tree,
  breadth-first". The options object kills that call shape and leaves room for a
  third setting without another positional.
- **Shallow copy, not deep.** The constructor copies and freezes the two arrays but
  not their contents: node reference identity is load-bearing — callers hold nodes
  returned from one method and pass them to another, and identity comparisons must
  keep working.
- **The identity key stays private.** The `document:index` key that de-duplicates
  traversal is a `#` member of the class, not a new public export; nothing outside
  the entity needs it, and publishing it would add surface for no consumer.

### The fold map

Every export in the pre-promotion family and what became of it. Method names are
entity methods on `BrowserSnapshot`, shown with their call shape where it differs
from the old signature. Deliberately without file line numbers: line-numbered
claims go stale, and the guide is the surface that cannot.

| Old export                        | Outcome                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `decodeBrowserSnapshot`           | retained leaf — the producer, now returning `BrowserSnapshotInput` |
| `walkBrowserSnapshot`             | `walk()`                                                           |
| `walkBrowserSnapshotBreadthFirst` | `walk({ order: 'breadth' })`                                       |
| `walkBrowserNode`                 | `walk({ root })`                                                   |
| `walkBrowserNodeBreadthFirst`     | `walk({ root, order: 'breadth' })`                                 |
| `descendantsOfBrowserNode`        | `descendants(node)`                                                |
| `documentOfBrowserNode`           | `document(node)`                                                   |
| `childrenOfBrowserNode`           | `children(node)`                                                   |
| `parentOfBrowserNode`             | `parent(node)`                                                     |
| `siblingsOfBrowserNode`           | `siblings(node)`                                                   |
| `precedingSiblingsOfBrowserNode`  | `siblings(node, 'preceding')`                                      |
| `followingSiblingsOfBrowserNode`  | `siblings(node, 'following')`                                      |
| `ancestorsOfBrowserNode`          | `ancestors(node)`                                                  |
| `isBrowserNodeDescendant`         | removed — containment derives from `ancestors(node)`               |
| `commonAncestorOfBrowserNodes`    | `common(first, second)`                                            |
| `computeBrowserNodeDistance`      | `distance(first, second)`                                          |
| `findBrowserNode`                 | `find(query)` — a `BrowserNodeQuery` or a predicate                |
| `findBrowserNodes`                | `filter(query, limit)`                                             |
| `findBrowserDescendant`           | removed — compose `descendants(node)` with `matchesBrowserNode`    |
| `closestBrowserNode`              | `closest(node, query)`                                             |
| `attributeOfBrowserNode`          | retained leaf — node-only, needs no snapshot                       |
| `matchesBrowserNode`              | retained leaf — node-only; `find`/`filter`/`closest` compose it    |
| `isBrowserNodeVisible`            | retained leaf — node-only, needs no snapshot                       |
| `nodeToPath`                      | `path(node)`                                                       |

The folded functions were removed rather than kept beside the entity: with zero
production callers, retaining them would have left two public ways to do one thing.

### Outcomes

The risks named before the work resolved as follows. The name collision — the
largest predicted churn — was settled by the `Input`/`Interface` split, so the data
type and the behavioral contract each have their own name and the class keeps the
bare one; no consumer had to choose between a structural type and a class.
Serializability is pinned by tests rather than by assertion: one round-trips a
snapshot through `JSON.stringify`, rehydrates it through `createBrowserSnapshot`,
and proves the rehydrated entity navigates identically, and one proves the
constructor's defensive copy and freeze. The predicted guide and test churn landed
in one change and came back parity-green. And no scope crept in: the entity gained
no rendering, extraction, or distillation, and the package's dependency list is
unchanged.

### The live surface

`guides/src/browser.md` documents the shipped entity — the factory, the surface
row, the thirteen-method table, and the worked example — and guide parity enforces
that every backticked name there resolves to a real export. That guide is the
surface of record. This document is the history of how the surface got here, not a
second description of it; where the two disagree, the guide is right and this file
is stale.

---

## Part 2 — The future `browser → html` dependency edge (DEFERRED)

### The reconciled decision

From the `@orkestrel/html` campaign, on the record:

- `@orkestrel/html` is the **HTML foundation**, published at `0.0.1`. It takes
  one runtime dependency, `@orkestrel/contract`, and `@orkestrel/markdown` is
  being rebuilt on top of it. (This corrects an earlier statement here that html
  was a leaf depended on by nobody — true when written, false now.)
- **`@orkestrel/browser` must never be a dependency of `@orkestrel/html`.** The
  snapshot traversal in Part 1 navigates **CDP DOM snapshots**, not HTML source;
  it does **not** belong in `@orkestrel/html` and must not move there.
- Today there is **no edge**. `@orkestrel/browser`'s ecosystem dependencies are
  `@orkestrel/contract`, `@orkestrel/emitter`, and `@orkestrel/websocket`;
  `@orkestrel/html` is absent, correctly.
- The **only** correct future edge is `browser → html`, and only once
  `@orkestrel/browser` earns a real, content-returning convenience with actual
  callers. A `browser → markdown` edge would be a second, heavier option — see
  the cost comparison below.

### Proposed API and dependency (when the trigger fires)

A single content-distillation convenience on the frame/page that pipes the
already-captured HTML through the `@orkestrel/html` pipeline and returns the
content worth reading. There are now **two** candidate shapes, and they cost
different amounts, because `@orkestrel/html` no longer projects to markdown.

**First, the objection that has to be answered.** `content()` already returns a
`text` field (`src/core/types.ts:247`), and it is `document.body.innerText`
evaluated in the page (`src/core/BrowserFrame.ts:101-125`). So "browser can
already give me text" is true, and any text-returning convenience must justify
itself against that field, not against nothing.

It can. `content().text` is the **whole body**, boilerplate included — nav,
footer, aside, cookie banner, hidden content. What `@orkestrel/html` adds is not
text extraction but **content selection**: `distill()` prunes boilerplate and
hidden subtrees, sanitizes, extracts the content region, and resolves relative
URLs against a base. The value of the edge is the pruning, not the rendering.
Any framing of Part 2 that sells "text" rather than "the article" is selling
something browser already has.

**Option A — distilled text, one edge (`browser → html`).** `renderText` is
html's own projection and is structural: it tab-separates table cells,
newline-separates rows and block boundaries, and keeps whitespace beneath `pre`
verbatim, matching the platform's `innerText` on those cases. It still drops
heading level, link destination, list markers and ordinals, nesting depth, and
image `alt`.

```ts
// PROPOSED-NEW on BrowserFrameInterface / BrowserPageInterface
text(): Promise<string>
```

```ts
// inside BrowserFrame.text()
const { html, url } = await this.content() // src/core/BrowserFrame.ts:101
const article = createHTML(html).distill({ base: url }) // @orkestrel/html — sanitizes first
return renderText(article.document) // @orkestrel/html
```

Note the name collision this exposes: a `text()` method returning distilled text
sits beside a `content().text` field returning whole-body text, and one word
cannot carry both meanings. That is an argument for naming the method after the
artifact it selects — `article()` — rather than after its format.

**Option B — markdown, two edges (`browser → markdown → html`).** Markdown
conversion now lives in `@orkestrel/markdown`, which itself depends on
`@orkestrel/html`. A markdown-returning convenience therefore pulls both
packages, including html's ~2,100-entry character-reference table, to produce a
string. It preserves heading level, link destination, and list ordinals that
Option A loses.

```ts
// PROPOSED-NEW — heavier; requires @orkestrel/markdown
markdown(): Promise<string>
```

- **Exact new dependency:** for Option A, `@orkestrel/html` at its published
  version, added to `package.json` **only** when the method ships — the first and
  only `browser → html` edge. For Option B, `@orkestrel/markdown` instead, with
  html arriving transitively.
- **Note on `distill`:** it sanitizes internally before extracting, so a separate
  `.sanitize()` in the chain is redundant. The earlier draft of this document
  chained both; that was noise.
- **Environment:** **core**. `content()` returns `BrowserContentResult`
  (`types.ts:243`) whose `html` is a plain string produced host-independently
  (`BrowserFrame.content()` reads `document.documentElement.outerHTML` over CDP,
  `src/core/BrowserFrame.ts:101–125`), and `@orkestrel/html` is host-independent,
  so nothing forces this into browser or server.
- **Why it is gated:** this is **product-convenience policy**, not framework
  mechanism. AGENTS.md "mechanism, not product policy" and "minimal public API —
  add capability with its real consumer; do not speculate" both apply. Either
  method encodes an opinion — distill, then render, in one particular projection —
  that belongs to a consumer until enough consumers want the same opinion. It
  must have real callers before adoption. The two-option split makes this sharper,
  not softer: picking a return type on a package's behalf is exactly the product
  decision the rule reserves for the consumer.

### Current zero-coupling alternative (available today)

No new API and no dependency edge are needed to do this now. A consumer composes
the two packages over the plain-string `BrowserContentResult.html` boundary,
with zero coupling between them:

```ts
import { createBrowser } from '@orkestrel/browser/server'
import { createHTML, renderText } from '@orkestrel/html' // consumer's own dependency

const browser = createBrowser({ headless: true })
await browser.connect()
const page = await browser.create({ url: 'https://example.com' })

const { html, url } = await page.content() // BrowserContentResult
const article = createHTML(html).distill({ base: url }) // boilerplate pruned, links absolute
const text = renderText(article.document) // structural plain text

await browser.destroy()
```

A consumer wanting markdown swaps the second import for `@orkestrel/markdown`'s
HTML-to-markdown projection and keeps the same seam.

`@orkestrel/browser` hands out a string; `@orkestrel/html` consumes a string; the
seam is the plain `html` field, so neither package knows about the other. This is
the correct arrangement until demand justifies moving the three-line pipeline
inside the library — and it is the arrangement that lets a consumer choose its own
return type, which is the whole reason Part 2 stays deferred.

### Deferral gate

Part 2 is **not now**. Build the convenience and add the dependency only when
there are **multiple real callers** repeating the exact
`content().html → distill → render` pipeline **with the same return type** — the
concrete consumer that the minimal-API law requires. Callers that disagree on the
projection are evidence the seam belongs where it is, not evidence of demand.
Until then, the zero-coupling composition above is the supported path and the edge
stays unbuilt.

If the trigger does fire, prefer **Option A** unless the callers specifically need
the semantics markdown preserves and text cannot: one dependency edge instead of
two, and no package pulled in solely to format a string.

---

## Non-goals

- Moving any snapshot traversal into `@orkestrel/html` (it navigates CDP
  snapshots, not HTML — permanently out).
- Making `@orkestrel/browser` a dependency of `@orkestrel/html`, ever.
- Wrapping `BrowserNode`/`BrowserDocument` in cursor/handle objects; nodes stay
  plain serializable data.
- Adding `@orkestrel/html` (or any dependency) as part of Part 1 — the entity
  shipped with the package's dependency list unchanged.
- Expanding the snapshot entity with rendering, extraction, or distillation.

## Open questions

1. **Name collision resolution — answered.** The plain-data type is
   `BrowserSnapshotInput` and the contract is
   `BrowserSnapshotInterface extends BrowserSnapshotInput`, so the class keeps the
   bare `BrowserSnapshot` name. The split was chosen because it leaves callers one
   name per job — data in, entity out — instead of asking them to distinguish a
   structural type from a class of the same name.
2. **`walk` ordering shape — answered.** One `walk(options?)` carrying
   `order?: 'depth' | 'breadth'` shipped, because the ordering pair is data and the
   four separate walk functions were four names for one traversal; the options
   object was chosen over positionals so that no caller ever has to write
   `walk(undefined, 'breadth')`.
3. **Sibling API — answered.** `siblings(node, relation?)` shipped and reads
   cleanly: the relation names its axis, absence means every sibling, and three
   exports became one method.
4. **Part 2 trigger threshold.** How many repeated call sites count as
   "demonstrated demand" before a content convenience and the `@orkestrel/html`
   edge are justified?
5. **Part 2 return type and name.** Option A (one edge) or Option B (two edges)?
   Decide with the real consumer, since the choice determines how many packages
   `@orkestrel/browser` depends on. If callers split on return type, the seam stays
   outside. On naming: `text()` collides in meaning with the existing
   `content().text` field, so prefer a name describing the selected artifact —
   `article()` — over one describing its format.
6. **Should `base` default to the content URL?** The examples pass
   `{ base: url }` from `content()`, which is correct — it is the URL after
   navigation, so redirects resolve properly. If a convenience ships, confirm
   whether it defaults `base` that way. Convenient, but it is one more opinion
   encoded on the consumer's behalf, and a caller distilling saved HTML from
   elsewhere would want to override it.
