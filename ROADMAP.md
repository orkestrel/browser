Each item is a chunk that reaches green before the next. An item keeps its number for life: a closed item leaves this file and its number is never reused, so a commit message citing an item by number stays true.

- **1.** Declare an optional capture capability on `BrowserViewInterface` so a replay reads the view's `emitter` and `screenshot` through the contract rather than through structural checks (`src/core/BrowserReplay.ts`).
- **2.** Publish a structured tabs listing from the toolset so `follow` resolves a `switch` step's tab from data rather than from the `tabs` tool's text through `parseBrowserTabLine`.
- **3.** Carry the coded fault of a `perform` on the result itself rather than in a `WeakMap` keyed by the result object, which loses the code on a copy; the result's shape is `@orkestrel/tool`'s, so this is a cross-package change with that package.
