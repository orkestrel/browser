# Proposal: promote the browser snapshot traversal helpers to a `BrowserSnapshot` entity, and define the future `browser → html` edge

## Status

Proposed / **deferred**. Neither part is in current scope. Part 1 is a shape
change with no new dependency, ready to schedule as its own campaign. Part 2 is
gated on demonstrated demand and must not be built speculatively. This document
records the reconciled decisions from the `@orkestrel/html` package build so the
next campaign starts from evidence rather than memory.

## Context and motivation

`src/core/helpers.ts` has grown a large family of free functions that all take a
decoded `BrowserSnapshot` (and usually a `BrowserNode`) and read the flattened
CDP DOM-snapshot tree: walk, find, filter, children, parent, siblings,
ancestors, descendants, closest, document, path, distance. Twenty-three of these
navigate or query one shape; one — `decodeBrowserSnapshot` — produces it.

This is exactly the pattern `.claude/rules/names.md` calls out:

> When a helper family grows around one shape, promote it to a class with
> entity-scoped one-word methods.

Separately, the `@orkestrel/html` build raised a recurring question — "should the
browser snapshot traversal live in, or depend on, `@orkestrel/html`?" — that
deserves a written, verifiable answer so it is not re-litigated per campaign.

---

## Part 1 — Promote the traversal family to a `BrowserSnapshot` entity

### Evidence: the current family (census)

Every function below lives in `src/core/helpers.ts` and is a public export.
`decodeBrowserSnapshot` is the producer; the rest are readers/queries over its
result. All are documented in `guides/src/browser.md` (Snapshot helpers table,
lines 142–165) and exercised by `tests/src/core/helpers.test.ts`.

| Function                          | `helpers.ts` | One-line purpose                                              |
| --------------------------------- | ------------ | ------------------------------------------------------------ |
| `decodeBrowserSnapshot`           | 3020         | Decode a CDP `DOMSnapshot.captureSnapshot` into a `BrowserSnapshot` (**the producer**) |
| `walkBrowserSnapshot`             | 3193         | Lazily walk every node, depth-first                          |
| `walkBrowserSnapshotBreadthFirst` | 3228         | Lazily walk every node, breadth-first                        |
| `walkBrowserNode`                 | 3261         | Lazily walk one subtree, depth-first, root included          |
| `walkBrowserNodeBreadthFirst`     | 3291         | Lazily walk one subtree, breadth-first, root included        |
| `descendantsOfBrowserNode`        | 3317         | Lazily walk a node's descendants, excluding itself           |
| `documentOfBrowserNode`           | 3338         | Resolve the `BrowserDocument` containing a node              |
| `childrenOfBrowserNode`           | 3356         | Direct children (entering iframe content documents)          |
| `parentOfBrowserNode`             | 3379         | Structural parent (iframe root → owning frame node)          |
| `siblingsOfBrowserNode`           | 3397         | Every sibling except the node                                |
| `precedingSiblingsOfBrowserNode`  | 3420         | Siblings before the node, in order                           |
| `followingSiblingsOfBrowserNode`  | 3444         | Siblings after the node, in order                            |
| `ancestorsOfBrowserNode`          | 3468         | Nearest-first ancestor chain                                 |
| `isBrowserNodeDescendant`         | 3496         | Whether one node is below another across frames              |
| `commonAncestorOfBrowserNodes`    | 3514         | Nearest common ancestor of two nodes                         |
| `computeBrowserNodeDistance`      | 3533         | Tree edge-count between two nodes                            |
| `findBrowserNode`                 | 3559         | First node satisfying a predicate                            |
| `findBrowserNodes`                | 3577         | Bounded list of nodes satisfying a predicate                 |
| `findBrowserDescendant`           | 3605         | First matching descendant beneath a node                     |
| `closestBrowserNode`              | 3624         | Nearest match from a node upward through ancestors           |
| `attributeOfBrowserNode`          | 3640         | Read one attribute off a node                                |
| `matchesBrowserNode`              | 3651         | Test a node against a declarative `BrowserNodeQuery`         |
| `isBrowserNodeVisible`            | 3677         | Whether a node reports a non-empty layout box                |
| `nodeToPath`                      | 3689         | Deterministic frame-qualified structural path for a node     |

Supporting shapes in `src/core/types.ts`: `BrowserNode` (1400), `BrowserDocument`
(1424), `BrowserSnapshot` (1436), `BrowserNodePredicate` (1458),
`BrowserNodeQuery` (1468).

### The load-bearing fact: only the producer has a production caller

Across `src/`, the **only** call site of any function in this family is
`decodeBrowserSnapshot`, imported at `src/core/BrowserPage.ts:50` and called once
in `BrowserPage.snapshot()` at `src/core/BrowserPage.ts:368`. The other
twenty-three functions have **no production caller** — their only consumers are
`tests/src/core/helpers.test.ts` and the guide example. (The single other `src/`
mention is a `{@link matchesBrowserNode}` reference in a TSDoc comment at
`src/core/types.ts:1461`, not a call.)

That asymmetry is the whole diagnosis. `decodeBrowserSnapshot` is a real
production leaf feeding `snapshot()`. The traversal set is a public,
well-tested, but consumer-less **library surface** — a family of ~20 free
functions that a caller must import individually and thread `snapshot` through by
hand. This is the precise moment `names.md` says to promote.

### Diagnosis and proposed surface

Fold the readers into a `BrowserSnapshot` entity whose methods are entity-scoped
and one word, mirroring how the ecosystem's document packages expose
`walk`/`find`/`filter`/`fold` over their ASTs. The snapshot supplies the
context, so the frame-qualified `…OfBrowserNode` suffixes disappear; a node stays
plain serializable data passed as an argument (it is **not** wrapped in a cursor
object — see Risks).

Proposed contract in `src/core/types.ts` (all **proposed-new** unless noted):

```ts
/** Node ordering for a snapshot walk. A conventional pair, so a union. */
export type BrowserWalkOrder = 'depth' | 'breadth'

/** Sibling relationship selector; absence means every sibling. */
export type BrowserSiblingRelation = 'preceding' | 'following'

/** A navigable, serializable snapshot of every document attached to a page. */
export interface BrowserSnapshotInterface {
	// Surface (readonly data — the current `BrowserSnapshot` shape, folded in)
	readonly documents: readonly BrowserDocument[]
	readonly styles: readonly string[]
	// Methods (compose the pure leaves)
	walk(root?: BrowserNode, order?: BrowserWalkOrder): Generator<BrowserNode>
	descendants(root: BrowserNode): Generator<BrowserNode>
	find(query: BrowserNodeQuery | BrowserNodePredicate): BrowserNode | undefined
	filter(query: BrowserNodeQuery | BrowserNodePredicate, limit?: number): readonly BrowserNode[]
	document(node: BrowserNode): BrowserDocument | undefined
	children(node: BrowserNode): readonly BrowserNode[]
	parent(node: BrowserNode): BrowserNode | undefined
	siblings(node: BrowserNode, relation?: BrowserSiblingRelation): readonly BrowserNode[]
	ancestors(node: BrowserNode): readonly BrowserNode[]
	closest(node: BrowserNode, query: BrowserNodeQuery | BrowserNodePredicate): BrowserNode | undefined
	common(first: BrowserNode, second: BrowserNode): BrowserNode | undefined
	distance(first: BrowserNode, second: BrowserNode): number | undefined
	path(node: BrowserNode): string
}
```

Notes on the shape, each tied to a rule:

- **`walk(root?, order?)`** collapses the four `walk*` functions. Depth vs
  breadth is a conventional ordering pair, which `names.md` explicitly keeps as a
  union (like `ascending`/`descending`), not a boolean and not two methods.
  `descendants` stays separate because "exclude the root" is a different result
  set, not an ordering.
- **`find`/`filter`** accept a `BrowserNodeQuery` directly, folding
  `matchesBrowserNode` into the entity so callers stop importing the matcher and
  writing their own predicate. `findBrowserNode`, `findBrowserNodes`, and
  `findBrowserDescendant` (via `descendants` + `find`) collapse into these two.
- **`siblings(node, relation?)`** collapses the three sibling functions;
  `relation` names its axis (a permitted discriminant), and absence means all.
- **`closest`** keeps its upward semantics and also accepts a query.
- Node-only predicates that never need the snapshot — `matchesBrowserNode`,
  `isBrowserNodeVisible`, `attributeOfBrowserNode` — stay as **exported, tested
  pure leaves** in `helpers.ts`. `find`/`filter`/`closest` compose
  `matchesBrowserNode`; the class does not re-wrap the node-only predicates.

### Before / after sketch

Before (caller imports N free functions, threads `snapshot` through each):

```ts
import {
	decodeBrowserSnapshot,
	walkBrowserSnapshot,
	findBrowserNode,
	ancestorsOfBrowserNode,
	closestBrowserNode,
	nodeToPath,
} from '@orkestrel/browser'

const snapshot = decodeBrowserSnapshot(raw, ['display'])
const article = findBrowserNode(snapshot, (n) => n.name === 'ARTICLE')
const chain = article ? ancestorsOfBrowserNode(snapshot, article) : []
const main = article ? closestBrowserNode(snapshot, article, (n) => n.name === 'MAIN') : undefined
const where = article ? nodeToPath(snapshot, article) : ''
```

After (one entity carries the tree; methods read one word):

```ts
import { createBrowserSnapshot } from '@orkestrel/browser'

const snapshot = createBrowserSnapshot(raw, ['display'])
const article = snapshot.find({ name: 'article' })
const chain = article ? snapshot.ancestors(article) : []
const main = article ? snapshot.closest(article, { name: 'main' }) : undefined
const where = article ? snapshot.path(article) : ''
```

`BrowserPage.snapshot()` returns the entity instead of the bare record; the one
production call site at `BrowserPage.ts:368` changes from `decodeBrowserSnapshot(...)`
to `createBrowserSnapshot(...)` (or `new BrowserSnapshot(...)`), and its return
type widens from the data interface to `BrowserSnapshotInterface`.

### Internals: what folds into the class, what stays a leaf

Applying the `architecture.md` leaf test so the class **composes** behavior and
never forwards 1:1 to a helper:

- **Fold into the class** (recursive spine / composition of leaves — methods or
  `#` private methods): `walkBrowserSnapshot*`, `walkBrowserNode*`,
  `descendantsOfBrowserNode`, `childrenOfBrowserNode`, `parentOfBrowserNode`,
  `siblingsOfBrowserNode`, `precedingSiblingsOfBrowserNode`,
  `followingSiblingsOfBrowserNode`, `ancestorsOfBrowserNode`,
  `commonAncestorOfBrowserNodes`, `computeBrowserNodeDistance`,
  `findBrowserNode`, `findBrowserNodes`, `findBrowserDescendant`,
  `closestBrowserNode`, `isBrowserNodeDescendant`, `nodeToPath`. These are the
  entity's defining engine; a `children(node)` method that only returned
  `childrenOfBrowserNode(this, node)` would be a banned 1:1 forward, so the
  algorithm moves into the class rather than staying a delegated wrapper.
- **Keep as exported, tested pure leaves** in `helpers.ts` (node-only, no
  snapshot, independently understandable): `matchesBrowserNode`,
  `isBrowserNodeVisible`, `attributeOfBrowserNode`. `documentOfBrowserNode` is a
  trivial `documents.find` lookup and becomes a `#` private method.
- **`decodeBrowserSnapshot`** stays the pure decode leaf; the factory
  `createBrowserSnapshot` wraps its output in the entity (or the constructor
  takes already-decoded data for rehydration — see below).

This keeps the functional core exported and the imperative shell (the navigator)
as a class, per AGENTS.md "functional core, imperative shell."

### Migration path

1. **Types first.** Add `BrowserSnapshotInterface`, `BrowserWalkOrder`,
   `BrowserSiblingRelation` to `types.ts`; resolve the name collision (below).
2. **Entity.** Add `src/core/BrowserSnapshot.ts` (one class), `createBrowserSnapshot`
   in `factories.ts`, barrel row in `index.ts`.
3. **Fold** the spine functions listed above out of `helpers.ts` into the class;
   retain the three node-only leaves.
4. **Update the one consumer** — `BrowserPage.snapshot()` — atomically; no
   compatibility re-exports (greenfield rule).
5. **Tests & guide.** Move `tests/src/core/helpers.test.ts` snapshot-traversal
   coverage onto the entity's methods; keep unit tests for the retained leaves;
   rewrite the `guides/src/browser.md` Snapshot section (lines 142–165, 191–257)
   to the entity surface with full parity.

**Decision — fold, do not keep parallel free functions.** The spine functions
have zero production callers, so retaining them beside the entity would leave two
public ways to do one thing (a superfluous-wrapper and minimal-API violation).
Fold them; keep only the genuinely reusable node-only leaves exported and tested.

### Acceptance criteria

- `BrowserSnapshotInterface` defined in `types.ts`; `BrowserSnapshot` class in
  its own file; `createBrowserSnapshot` factory; single barrel row.
- `BrowserPage.snapshot()` returns `BrowserSnapshotInterface`; no other `src/`
  behavior changes.
- The folded free functions are gone from the public surface; `matchesBrowserNode`,
  `isBrowserNodeVisible`, `attributeOfBrowserNode`, `decodeBrowserSnapshot`
  remain exported and unit-tested.
- Snapshot stays serializable: `JSON.parse(JSON.stringify(snapshot))` yields the
  `{ documents, styles }` data, and `createBrowserSnapshot(data)` rehydrates a
  fully navigable entity.
- Every backticked method in the rewritten guide resolves to a real export
  (parity green); `format → lint → check → build → test` pass.
- The entity remains in `@orkestrel/browser` **core** (no host globals, no new
  dependency).

### Risks

- **Name collision (primary).** `BrowserSnapshot` is currently the plain-data
  interface (`types.ts:1436`). The proposal reuses the name for the class and
  introduces `BrowserSnapshotInterface`, folding the `{ documents, styles }` data
  into the interface's readonly Surface. Every reference to the data type
  `BrowserSnapshot` must move to the interface or the class atomically. This is
  the largest churn and the main open question below.
- **Serializability.** `BrowserNode`/`BrowserDocument` must stay plain data —
  methods take nodes as arguments; nodes are never wrapped in cursors. A class
  instance still serializes to its own `{ documents, styles }` data; methods are
  re-attached only by re-wrapping parsed data. The acceptance test above pins
  this.
- **Guide/test churn.** ~20 documented functions and their tests move to the
  entity in one change; parity must not be suppressed during the transition.
- **Scope creep.** The entity must not gain HTML/markdown rendering — that is
  Part 2, and it must not leak forward into this refactor.

---

## Part 2 — The future `browser → html` dependency edge (DEFERRED)

### The reconciled decision

From the `@orkestrel/html` campaign, on the record:

- `@orkestrel/html` is a **leaf**: it depends on nobody in the family and is
  depended on by nobody yet.
- **`@orkestrel/browser` must never be a dependency of `@orkestrel/html`.** The
  snapshot traversal in Part 1 navigates **CDP DOM snapshots**, not HTML source;
  it does **not** belong in `@orkestrel/html` and must not move there.
- Today there is **no edge**. `@orkestrel/browser`'s only ecosystem dependencies
  are `@orkestrel/contract` and `@orkestrel/emitter` (`package.json:82–83`);
  `@orkestrel/html` is absent, correctly.
- The **only** correct future edge is `browser → html`, and only once
  `@orkestrel/browser` earns a real, content-returning convenience with actual
  callers.

### Proposed API and dependency (when the trigger fires)

A single content-distillation convenience on the frame/page — proposed name
`page.markdown()` (alternatives: `article()`, `distill()`) — that pipes the
already-captured HTML through the `@orkestrel/html` pipeline and returns
LLM-ready markdown:

```ts
// PROPOSED-NEW on BrowserFrameInterface / BrowserPageInterface
markdown(): Promise<string>
```

Pipeline (all `@orkestrel/html` symbols below are **external**, from that
package's published surface per the html campaign — not exports of this repo):

```ts
// inside BrowserFrame.markdown()
const { html } = await this.content()                 // src/core/BrowserFrame.ts:101
const doc = createHTML(html).sanitize().distill()      // @orkestrel/html
return renderMarkdown(doc)                              // @orkestrel/html
```

- **Exact new dependency:** `@orkestrel/html` at its published version, added to
  `package.json` **only** when this method ships. This is the first and only
  `browser → html` edge.
- **Environment:** **core**. `content()` returns `BrowserContentResult`
  (`types.ts:243`) whose `html` is a plain string produced host-independently
  (`BrowserFrame.content()` reads `document.documentElement.outerHTML` over CDP,
  `src/core/BrowserFrame.ts:101–125`), and `@orkestrel/html` is host-independent,
  so nothing forces this into browser or server.
- **Why it is gated:** this is **product-convenience policy**, not framework
  mechanism. AGENTS.md "mechanism, not product policy" and "minimal public API —
  add capability with its real consumer; do not speculate" both apply. `markdown()`
  encodes an opinion (sanitize, then distill, then render) that belongs to a
  consumer until enough consumers want the same opinion. It must have real
  callers before adoption.

### Current zero-coupling alternative (available today)

No new API and no dependency edge are needed to do this now. A consumer composes
the two packages over the plain-string `BrowserContentResult.html` boundary,
with zero coupling between them:

```ts
import { createBrowser } from '@orkestrel/browser/server'
import { createHTML, renderMarkdown } from '@orkestrel/html' // consumer's own dependency

const browser = createBrowser({ headless: true })
await browser.connect()
const page = await browser.create({ url: 'https://example.com' })

const { html } = await page.content()                  // BrowserContentResult.html: string
const markdown = renderMarkdown(createHTML(html).sanitize().distill())

await browser.destroy()
```

`@orkestrel/browser` hands out a string; `@orkestrel/html` consumes a string; the
seam is the plain `html` field, so neither package knows about the other. This is
the correct arrangement until demand justifies moving the three-line pipeline
inside the library.

### Deferral gate

Part 2 is **not now**. Build `page.markdown()` and add the `@orkestrel/html`
dependency only when there are **multiple real callers** repeating the exact
`content().html → sanitize → distill → renderMarkdown` pipeline — the concrete
consumer that the minimal-API law requires. Until then, the zero-coupling
composition above is the supported path, and the edge stays unbuilt.

---

## Non-goals

- Moving any snapshot traversal into `@orkestrel/html` (it navigates CDP
  snapshots, not HTML — permanently out).
- Making `@orkestrel/browser` a dependency of `@orkestrel/html`, ever.
- Wrapping `BrowserNode`/`BrowserDocument` in cursor/handle objects; nodes stay
  plain serializable data.
- Adding `@orkestrel/html` (or any dependency) as part of Part 1.
- Expanding the snapshot entity with rendering, extraction, or distillation.

## Open questions

1. **Name collision resolution.** Recommended: fold `{ documents, styles }` into
   `BrowserSnapshotInterface` and give the class the `BrowserSnapshot` name. Is
   any consumer relying on `BrowserSnapshot` as a bare structural (non-class)
   type in a way that makes a different split (e.g. a distinct serializable data
   name) cheaper? Needs a consumer sweep before the campaign.
2. **`walk` ordering shape.** Is `order?: BrowserWalkOrder` the right call, or
   should depth/breadth stay two methods as the code has them today? The union
   is defensible under `names.md`, but the current split is the status quo.
3. **Sibling API.** `siblings(node, relation?)` vs. keeping `preceding`/
   `following` as separate concerns — confirm the discriminant reads cleanly.
4. **Part 2 trigger threshold.** How many repeated call sites count as
   "demonstrated demand" before `page.markdown()` and the `@orkestrel/html`
   edge are justified?
5. **Part 2 method name.** `markdown()` vs. `article()` vs. `distill()` — decide
   with the real consumer, since the name should describe the returned artifact.
