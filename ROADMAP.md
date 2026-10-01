Each item is a chunk that reaches green before the next. An item keeps its number for life: a closed item leaves this file and its number is never reused, so a commit message citing an item by number stays true.

- **1.** Declare an optional capture capability on `BrowserViewInterface` so a replay reads the view's `emitter` and `screenshot` through the contract rather than through structural checks (`src/core/BrowserReplay.ts`).
- **2.** Publish a structured tabs listing from the toolset so `follow` resolves a `switch` step's tab from data rather than from the `tabs` tool's text through `parseBrowserTabLine`.
- **3.** Carry the coded fault of a `perform` on the result itself rather than in a `WeakMap` keyed by the result object, which loses the code on a copy; the result's shape is `@orkestrel/tool`'s, so this is a cross-package change with that package.
- **5.** Make the `createFakeBrowserProcess` descendant case in `tests/setupServer.test.ts` hold under load: on 2026-10-01 the integrated gate set read the descendant as exited within its 300 ms window once and the same file passed 165 of 165 on a rerun, so the case binds a timing the host does not promise.
