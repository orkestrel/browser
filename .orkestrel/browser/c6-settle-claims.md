# Unit c6-settle claims (the Opus lane's report, verbatim; the diff `5179859..HEAD` uncommitted, 20 tracked files changed plus 2 added)

All six prescriptions (N1 to N6) are in place. Every gate the brief lists passes except `npm run test:guides`, which stays red as the brief expects: 8 of 199 cases fail, all guide documentation owed by the guide unit. No `prove` tool was registered in this session, so there are no receipts. Each claim is backed by a named test, and each mutation turns its named test red.

## Files and line ranges, per prescription

**N1: the page owns the steps and their sessions**
- `src/core/BrowserPage.ts`:
  - The steps emitter, parent map and loader map are at 216–223.
  - `#watchSession` and `#pairSessionHandlers` (1160–1235) subscribe the per-session handlers: the page session's in the constructor, each child session's at attach. Nothing subscribes per action.
  - `#enableFrameSession` (1239) sends lifecycle enablement and `Target.setAutoAttach` (filtered to iframes) on each child session.
  - `#readFrameTree` (1265) returns the loader and the parent. `#readReadiness` (1288) emits the load after publication.
  - The one ownership rule is `#accepts` (1598). The step handlers are at 1571–1649 and `#handleFrameDetached` at 1671.
  - `#handleAttached(owner, …)` (1819) takes the parent from `parentFrameId`, accepts nested attaches from child sessions, and emits the publication commit (1894).
  - `frames()` (657) records parents.
- `src/core/elements/BrowserElementManager.ts`: `#sessions`, `#own`, `#owns`, `#watch`, `#unwatch`, `#frameChanged`, `#detached` and the `session` listener are removed. It drops references on the page's `commit` and `detach` steps (`#commit` 485, `#detach` 490).
- `src/core/types.ts`: `BrowserNavigationEventMap` (376) and `BrowserElementManagerInput.steps` (1845).

**N2: the record**
- `src/core/BrowserNavigationRecord.ts` (added, 383 lines). It is not exported from the barrel and is listed as internal in `tests/guides.test.ts`.
- `src/core/BrowserNavigationManager.ts`: `record` (84). A lifetime aborts with the page-closed error (46, 160).
- `src/core/types.ts` 283–381: `record`, `BrowserNavigationRecordInterface`, `BrowserDestinationRelationship`, `BrowserDestination`, `BrowserSettlementOptions`, `BrowserNavigationStage`, `BrowserSettlementResult`.

**N3: the toolset settles through the record**
- `src/core/BrowserToolset.ts`:
  - `#click` 434, `#type` 475, `#press` 551, `#settle` 829, `#locate` 914.
  - Every member the subjective design's part (4) lists is deleted. `#sequence` (170) survives only as the observer token.
  - The class TSDoc paragraph (98–108) is rewritten to describe the record and the observer.
- `BrowserToolsetWatch` loses `requested`, `navigated` and `lifecycle`.
- `src/core/BrowserFrame.ts` is byte-identical to its pre-checkpoint content, and the `unsubscribe` text is back to its original wording.

**N4: the submit observer owned by token**
- `src/core/compilers.ts` 111–175: `compileSubmitObserverExpression(token)` and `compileSubmitReadExpression(token)`. A read whose token differs answers `null` and removes nothing.
- `src/core/BrowserToolset.ts`:
  - `#observe` 927: the action owns a document from the moment its installation is sent, and the input's document must install.
  - `#install` 946, `#readSubmissions` 963, `#unobserve` 1013.

**N5: tests and fixtures**
- Tests:
  - `tests/src/core/BrowserNavigationRecord.test.ts` (added, 24 cases).
  - `tests/src/core/BrowserPage.test.ts`: added describe "BrowserPage navigation steps", 5 cases.
  - `tests/src/core/BrowserNavigationManager.test.ts` (+2) and `tests/src/core/elements/BrowserElementManager.test.ts` (+1).
  - `tests/src/core/BrowserToolset.test.ts`: added "navigation settlement" and "observer cleanup" blocks; the file has 99 cases.
  - `tests/src/core/compilers.test.ts`, `tests/src/core/BrowserFrame.test.ts`, and `tests/service/toolset.test.ts` (+3).
- Fixtures and setup:
  - `tests/setup.ts` and `tests/setup.test.ts`.
  - `tests/setupServer.ts` and `tests/setupServer.test.ts`: routes `/frame/local`, `/frame/away`, `/frame/nested`, `/frame/middle` and `/search`, and a `_parent` coupon form on `/frame/inner`.
  - `tests/setupPolicy.ts` (two deadline rows) and `tests/guides.test.ts` (internal list).

Diffstat: 20 tracked files changed, 3147 insertions, 876 deletions, plus the 2 added files of 383 lines each.

## Claims
1. The page accepts a step about a frame only from the session that owns it, and drops a superseded session's step. Test: "ignores a commit and stop from the session a nested frame left for its own session".
2. The start step is `frameStartedNavigating` with its loader. A `currentTab` request is a start without a loader, and a `newTab` request is ignored. Test: "starts a record from the started step with its loader, else from a request in the current tab".
3. A frame session's load matches by loader, and a stop is a load only after a commit that named no loader. Test: "reports a frame session load by its loader and a stop only after a commit that named no loader".
4. Publication recovers the commit and the load, and a swap is not a detach. Test: "reports a commit and load for an out-of-process frame whose document committed and loaded before its session enabled".
5. A published frame's parent comes from its target, and an unnamed parent stays unknown. Test: "names a published frame parent from its target and leaves an unnamed parent unknown".
6. The record's selection rules hold: destinations, supersession, loader match, same-document completion, bounds, abort, a cancellation in the same turn, and close. Covered by the 24 record cases.
7. `record` adds no client registration, and the element manager subscribes to no commit or detach of its own. Proven with the added `RecordingCDPClient`.
8. The toolset matrix covers every row of the subjective table and every objective row the brief lists. It runs over the real page, record, toolset and element manager against the scripted transport, holding each stage back separately.
9. Live on Chromium 141: the 303 cart and the prevented form (existing case), the swap in both directions, a nested `_parent`, and same-document completion.

## Readings applied (N6)
- **P1:** `frameStartedNavigating` is the start step. A `currentTab` request is also a start, without a loader, and resolves `wait` first; the started step then supersedes it by the same-frame rule. Pinned by claim 2.
- **P2 and P6:**
  - The page session never reports an out-of-process commit, so it is accepted for every frame and there is no duplicate to drop.
  - Start and commit pair across sessions by frame and loader.
  - `waitForDebuggerOnStart: false` is kept, and publication recovers the commit and the load.
  - Pinned by claims 1 and 4 and the toolset session-move cases.
- **P3:** lifecycle events are enabled on each frame session, and loads match by loader. Pinned by claim 3.
- **P4:** auto-attach is enabled on every child session, filtered to iframes. The parent comes from `parentFrameId`, else the frame tree, else `frameAttached`. Pinned by claims 1 and 5 and the live nested case.
- **P5:** the outcome does not depend on it. Both orderings are tested: "settles a submission whose navigation starts before the input command replies" and "… between the input reply and the observer read".
- **P7:** a request followed by `navigatedWithinDocument` completes as `loaded`. The live `/search?q=tray` case settles well under the deadline, which confirms this Chromium sends that request as `currentTab`.
- No reading contradicted a READING assumption.

## Mutation record
Each mutation ran on a scratch copy under `tmp/codex/c6-mutations/`. The `n1`–`n5` logs and diffs are there; the copies were removed.
- **n1** (ownership rule dropped): `BrowserPage.test.ts` 1 failed, 134 passed. The nested superseded-session case fails at `expect(await record.settle({ timeout: 0 })).toEqual({` (line 3758), receiving `https://b.test/stale`.
- **n2** (loader match dropped): `BrowserNavigationRecord.test.ts` 2 failed, 21 passed. "rejects a commit and load whose loader differs…" fails at `expect(settled.count).toBe(0)` (line 56). The supersede case also fails (line 88).
- **n3** (record opened after the input): `BrowserToolset.test.ts` 1 failed, 98 passed. The inserted-text case fails at `expect(performance.now() - loaded).toBeLessThan(1_000)`, receiving 3894 ms.
- **n4** (token check dropped): `BrowserToolset.test.ts` 1 failed, 98 passed. "keeps a reinstalled observer when an earlier action removal lands after it" fails at `expect(windows.listeners).toBe(1)`.
- **n5** (destinations ignored): `BrowserToolset.test.ts` 12 failed, 87 passed. The `_top` case fails at `expect(settled.count).toBe(0)` (line 1314), along with every other destination-dependent case.

## Validation (from the worktree root)

| Command | Exit | Result |
|---|---|---|
| `npx oxfmt --check` (22 touched files) | 0 | clean |
| `npx oxlint --config .oxlintrc.json --deny-warnings` (22 touched files) | 0 | clean |
| `npm run check` | 0 | clean |
| `npm run test:src` | 0 | 1183 passed, 1 skipped |
| `npm run test:src:browser` | 0 | 224 passed, 1 skipped |
| `npm run test:setup` | 0 | 137 passed |
| `npm run test:setup:browser` | 0 | 21 passed |
| `npm run test:policy` | 0 | 114 passed, 1 skipped |
| `npm run build` | 0 | built |
| `npm run test:service` | 0 | 52 passed, 1 skipped |
| `npm run test:guides` | 1 | 8 failed, 191 passed |

- The service run used `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- The guides failures:
  - Undocumented exports: mine, plus older ones (`BROWSER_SUBMIT_KEY`, `BrowserDOMViewOptions`, `BrowserPageElement`, `readBrowserCapture`, and the `compileSubmit*` compilers).
  - The navigation manager method table and the interface/class parity checks.
  - A stale link to `BrowserElement.test.ts`.
- Formatting: I never ran the repository's format script. oxfmt ran through `--stdin-filepath`, and I copied its output back after checking it changed layout only.

## Deviations
None of these blocked the unit; each was settled inside scope.
1. **The `detach` step has a second field, `swapped: boolean`.** The existing element-manager swap case needs references dropped on a swap, while the brief says a swap is not a detach. The record therefore ignores a swapped detach. As an addition, an unswapped detach of the selected frame ends `settle` with the stage it reached; this is documented and tested.
2. **The ownership rule accepts every page-session step**, matching the element manager's existing rule. The stricter reading (drop page-session steps about an out-of-process frame) would break the existing case "reference reallocation, reuse after navigation, and overbroad child invalidation". P6 shows the page session never sends such steps, so live traffic is unaffected.
3. **Lifecycle enablement and auto-attach on a child session are sent before the frame-tree read but not awaited.** Unowned `BrowserRegistry.test.ts` cases answer only `Page.enable` and `Runtime.enable`, so awaiting would hang publication there. The readiness read runs after publication. This relies on the session handling its commands in order, which the live runs are consistent with.
4. **An aborted action sends its observer removals but does not wait for them,** the same as while a dialog is open. This keeps an abort prompt.
5. **The main frame is observed through its census frame.** `page.evaluate` runs in the main world, not the isolated one, so every `click` and `type` makes one `Page.getFrameTree` call.
6. **`type` without `submit` also opens a record before the edit.** This keeps its old behaviour of following a main-frame navigation the edit starts.
7. **Public signatures outside the navigation section change:** `BrowserElementManagerInput.steps`, and the public `BrowserNavigationManager` constructor gains `steps` and `parent`.
8. **Existing tests adjusted:**
   - Two receipt-timer cases gained `disposition: 'currentTab'`.
   - The capture-reserve abort case waits 20 ms for the abort's observer removal before taking its snapshot.
   - The in-process child arrangement uses a distinct-backend tree, `BROWSER_ELEMENT_FRAMED_FIXTURE`. With the shared tree, a backend collision on one session resolved Save to the main frame.
   - The checkpoint's frame session-record test is replaced by a test of the restored contract.
   - The element fixture's page runs over `RecordingCDPClient`.

## Public surface for the guide unit
- **Added:**
  - `BrowserNavigationManagerInterface.record`
  - `BrowserNavigationRecordInterface` (`wait`, `settle`, `destroy`)
  - `BrowserDestinationRelationship`, `BrowserDestination`, `BrowserSettlementOptions`, `BrowserNavigationStage`, `BrowserSettlementResult`
  - `BrowserNavigationEventMap`
  - `BrowserElementManagerInput.steps`
- **Changed:**
  - The `BrowserNavigationManager` constructor adds `steps` and `parent`.
  - `compileSubmitObserverExpression(token)` and `compileSubmitReadExpression(token)`; the read answers `null` for another token.
  - `BrowserFrameInterface.unsubscribe` text is restored.
  - The `BrowserToolset` TSDoc paragraph is rewritten.
- **Removed:** `BrowserToolsetWatch.requested`, `.navigated` and `.lifecycle`.
- **Internal:** `class BrowserNavigationRecord`.

I deleted my scratch probe and the mutation runner. The brief's probe (`tmp/probes/c6-navigation.test.ts`) and the n1–n5 logs and diffs remain. Nothing is committed or stashed.


# Fix round (A1–A7; the Opus lane's report, verbatim; the diff `5179859..HEAD` uncommitted, 21 tracked files plus 2 added)

A1 to A7 are applied in the same worktree, and every gate the brief lists passes: `test:src` 1188 passed with 1 skipped, and `test:service` 52 passed with 1 skipped, as expected. Each of a1–a5 and the n5 rerun reddens exactly its named case, on scratch copies under `tmp/codex/c6-mutations/`. The only file touched outside the unit's owned list is `tests/src/core/BrowserRegistry.test.ts`, which the brief allowed for A5's fixture replies. Nothing is committed or stashed, and no Python was used.

## Files and line ranges, per prescription

**A1 (claim 4): publication never recommits a document already reported**
- `src/core/BrowserPage.ts`:
  - `#handleAttached` clears the frame's reported loader at the attach (1869).
  - `#readFrameTree` (1260) returns the tree's loader even when a live report changed the attaching record. It only skips the URL overwrite in that case.
  - Publication (1896) emits its commit only when no live commit was accepted since the attach, so a known loader is never overwritten with `undefined`.
  - The readiness read is tied to the loader already on record for the frame.
- Test: `tests/src/core/BrowserPage.test.ts:3855`, "keeps a navigation that starts while its frame publishes from completing on the document the frame already reported". It follows the brief's ordering: tree reply held, record opened after A's start, A's real commit, B's start, tree released. The record stays `requested` at B's URL. B's commit and B's load then complete it, each stage checked separately.

**A2 (O2): `type`'s edit races the navigation start from its first input**
- `src/core/BrowserToolset.ts` 526–555 (`#type`):
  - `fill` or `select` races `record.wait` from its first input.
  - If the start wins, the receipt settles through `#settle` with the unfinished edit held as the queue barrier, and no submission is sent.
- Tests in `tests/src/core/BrowserToolset.test.ts`:
  - 1192, added: "settles a navigation the edit starts while its input is still pending, holding the edit as the queue barrier". The `Input.insertText` reply is withheld while its handler starts, commits, and loads a navigation. The receipt settles on the navigation, no `Input.dispatchKeyEvent` is sent, and a following `press` waits until the edit is released.
  - 1130: the existing inserted-text case stays. It now asserts the view and timing only; the missing Enter is asserted in 1192.

**A3 (O1): ownership is validated before any document-state change**
- `src/core/BrowserPage.ts`:
  - `#handleSessionNavigated` (1572), `#handleSessionRouted` (1584), `#handleFrameDetached` (1669) and `#handleFrameAttached` (1527) call `#accepts` before touching the epoch, the world cache, parents, or loaders.
  - `#handleFrameDetached` carries the explicit authorization comment: the page session is entitled to report any frame's swap or removal.
- Test: the superseded-session case (3721) gains a reading of N's current document taken at 3832. It stays fresh after a stale commit and a removal reported by the parent session. As a control, it goes stale on a commit from N's own session.

**A4 (D4): the cleanup wait is abortable**
- `src/core/BrowserToolset.ts`:
  - `#unobserve` (1049) passes the action's signal to its local wait. Its catch rethrows when the signal aborted; the removal command itself still carries no signal.
  - The action `finally` blocks release the queue turn in a nested `finally` (473, 576, 615).
  - `#execute` checks cancellation after the handler returns (348).
- Test (2509): "rejects with the abort reason and releases the queue when the action aborts while it waits for a withheld observer removal". A following `press` completes within 500 ms of the abort.

**A5 (D3): enablement is awaited before the frame-tree read**
- `src/core/BrowserPage.ts` `#enableFrameSession` (1238) awaits `Page.setLifecycleEventsEnabled` and `Target.setAutoAttach`. A refusal rejects with the client's coded error, and the existing attach-failure path drops and detaches the session.
- Fixtures that previously answered only `Page.enable` and `Runtime.enable` now answer both commands: 22 sites in `tests/src/core/BrowserPage.test.ts` and 3 in `tests/src/core/BrowserRegistry.test.ts`.
- Test (3956): "reads the frame tree of a frame session only after its lifecycle events and auto-attach are in effect". Both replies are held; no tree read goes out until both are answered.

**A6 (claim 8): stage separation and the added orderings**
- `_top` case (1335) and several-destination case (2136): request and start, then commit, then load, each released separately with a pending assertion between, and a load-to-receipt timing check.
- Nested `_parent` case (1400), where the parent is `child`, not the main frame: gains a load-to-receipt timing check and is n5's named case.
- Added rows:
  - A1: page 3855.
  - A2: toolset 1192.
  - A4: toolset 2509.
  - A nested target attaching through its parent's session while the parent's publication is pending: page 4001, "publishes a nested frame that attaches through its parent session while the parent publication is pending".

**A7 (O3):** `#ancestors` is renamed `#collectAncestors` (`src/core/BrowserNavigationRecord.ts:177`).

Diffstat for the whole uncommitted unit against the checkpoint: 21 tracked files changed, 3775 insertions, 1004 deletions, plus the two added record files.

## Claims (extended from 10)
10. A publication emits no commit for a document its session already reported, and never replaces a known loader with `undefined`. Pinned by page 3855 and mutation a1.
11. For `type`, a navigation that starts during the edit's first input wins the start race. The unfinished edit stays the queue barrier and no submission follows. Pinned by toolset 1192 and a2.
12. A report the page rejects changes nothing about the frame's current document. Pinned by the fresh-reading assertion in page 3721 and a3.
13. An abort during the cleanup wait rejects with the abort reason, and the queue is released within the bound. Pinned by toolset 2509 and a4.
14. A frame session's lifecycle events and auto-attach are in effect before its frame tree is read. Pinned by page 3956 and a5.
15. A nested target that attaches through its parent's session while the parent's publication is pending is published with its parent and followed on its own session. Pinned by page 4001.
16. Destination mapping is proven by the nested `_parent` case whose parent is not the main frame, with stages released separately. Pinned by toolset 1400 and the n5 rerun.

## Mutation record
Whole-file runs, `npx vitest run --config vite.config.ts --no-cache --project src:core <file>`, each in its own scratch copy under `tmp/codex/c6-mutations/`. Logs and diffs are kept there; the copies and the runner were removed.

- **a1** (the old publication path restored: the tree read returns `undefined` when the attaching record changed, and publication always commits). `BrowserPage.test.ts`: 1 failed, 137 passed. The publication-race case fails at line 3913, `expect(await record.settle({ timeout: 0 })).toEqual({`, receiving `https://other.test/a` instead of `https://other.test/b`.
- **a2** (the edit taken out of the race). `BrowserToolset.test.ts`: 1 failed, 100 passed. The held-edit case fails at line 1219, `await waitForCondition(`, with "the receipt settles while the insertion is withheld" not holding within 3000 ms.
- **a3** (the change before validation restored in `#handleSessionNavigated`). `BrowserPage.test.ts`: 1 failed, 137 passed. The superseded-session case fails at line 3839, `expect(reading.stale).toBe(false)`.
- **a4** (the cleanup wait given no signal). `BrowserToolset.test.ts`: 1 failed, 100 passed. The cleanup-abort case fails at line 2556, `expect(performance.now() - aborted).toBeLessThan(500)`, receiving 995.9.
- **a5** (the two enablement commands sent without awaiting them). `BrowserPage.test.ts`: 1 failed, 137 passed. The enablement-order case fails at line 3973, `expect([held.map((message) => message.method), trees.length]).toEqual(`, receiving both methods and one tree read.
- **n5 rerun** (destination relationships ignored: every destination resolved to its own frame). `BrowserToolset.test.ts`: 1 failed, 100 passed. The nested `_parent` case fails at line 1459, `expect(performance.now() - loaded).toBeLessThan(1_000)`, receiving 3888.8.

## Validation (from the worktree root)

| Command | Exit | Result |
|---|---|---|
| `npx oxfmt --check` (6 touched files) | 0 | clean |
| `npx oxlint --config .oxlintrc.json --deny-warnings` (same files) | 0 | clean |
| `npm run check` | 0 | clean |
| `npm run test:src` | 0 | 1188 passed, 1 skipped |
| `npm run test:setup` | 0 | 137 passed |
| `npm run test:policy` | 0 | 114 passed, 1 skipped |
| `npm run build` | 0 | built |
| `npm run test:service` | 0 | 52 passed, 1 skipped |

The service run used `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. The six scoped files are `src/core/BrowserPage.ts`, `src/core/BrowserToolset.ts`, `src/core/BrowserNavigationRecord.ts`, and the page, toolset, and registry test files. Formatting was applied through oxfmt's `--stdin-filepath` output, after checking the change was layout only.

## Deviations
1. **A1 keeps the tree's loader.** When a live report changed the attaching record, `#readFrameTree` still returns the tree's loader and only skips the URL overwrite. Without this, a same-document report during an attach would trigger a loaderless recommit. Because of this, mutation a1 has to restore both halves of the old path, the early `undefined` return and the unconditional commit, to reproduce the review's failure.
2. **A3's explicit authorization reuses `#accepts`.** That rule already grants the page session every frame; review D2 confirmed it. The detach handler states the entitlement in a comment instead of adding a second predicate.
3. **Two existing cases were amended to A2's contract:**
   - The inserted-text case now asserts only the destination view and timing, because a navigation started by the edit now means no Enter is sent.
   - The cleanup-abort case measures queue release against 500 ms: the withheld removal's own 1000 ms command timeout would otherwise let an unabortable wait finish in time.
4. **The `#execute` cancellation check can change an error.** If the toolset is destroyed while a handler finishes, the result becomes the ended error. No existing case depends on the previous behaviour.


# Second fix round (I3, I4, I5 superseding I1 and I2; the Opus lane's report, verbatim; the Orchestrator applied the `BrowserContext` patch; the diff `5179859..HEAD` uncommitted)

## c6-settle-fix2 (I1 to I4) and ruling I5: report

I5 is applied in the worktree `/home/user/browser/tmp/worktrees/c6`, and I replaced the reconstruction I1 and I2 patch rather than keeping both paths. Every gate in the worktree is green except `test:service`, which needs one shared-file patch. That patch is for `src/core/BrowserContext.ts`, which I don't own; it's given at the end with its validation. Nothing is committed.

### Deviations
- **D-I5-1: `test:service` is red until the patch is applied.** Ruling item (1) needs the page session's `Target.setAutoAttach` to pause new targets, and that call is in `BrowserContext.#configurePage`, outside my owned list. Without the patch, a context page attaches child frames unpaused, so their first commit is never seen:
  - `browser.test.ts` "lists the out-of-process frame at its document URL"
  - `toolset.test.ts` "...navigates an out-of-process frame to another process"
  - `toolset.test.ts` "...navigates an in-process frame out to another process"
  - `toolset.test.ts` "...nested out-of-process form targets _parent"
- **D-I5-2: one existing test changed its model.** The toolset case "refuses a click whose document was replaced after the observer installed" (`BrowserToolset.test.ts:2199`) used to go stale from the synthetic publication commit. It now emits the replacement session's own `Page.frameNavigated` (loader `loader-again`), which the live P2 reading shows always arrives after the resume. Between the attach and that commit, an element reading stays fresh.
- **D-I5-3: the i1 and i2 mutations no longer apply.** The lines they removed (the routed handler's document record and the readiness recovery) are deleted. Their logs from the fix2 run are kept as history in `tmp/codex/c6-mutations/i1.log` and `i2.log`.
- Nothing else deviates. No probe remains: `tmp/c6-edit/` and the I5 probe are deleted, and only the original `tmp/probes/c6-navigation.test.ts` is left.

### Changes by prescription

**I5, `src/core/BrowserPage.ts`**
- `#loaders` (221) replaces `#documents`. It holds the latest accepted commit's loader, used only by the stop rule in `#handleStopped` (1621–1631).
- `#enableFrameSession` (1239–1255) sends `Page.enable`, `Runtime.enable`, `Page.setLifecycleEventsEnabled`, then `Target.setAutoAttach {autoAttach:true, waitForDebuggerOnStart:true, flatten:true, filter:[{type:'iframe'}]}`, then resumes the target.
- `#resumeTarget` (1259–1263) is new. It sends `Runtime.runIfWaitingForDebugger` without waiting, and a target already gone ends with its detach.
- `#readFrameTree(session, attached, named)` (1268–1284) returns when the target's `parentFrameId` named a parent. Otherwise it sets parent, URL and name from the root, and only if the attach record is unchanged.
- `#attachWorker` (1286–1306) resumes after `Runtime.enable`. If that fails, the worker is detached and not resumed.
- `#attachPopup` (1334–1395) sets the popup's own auto-attach to `waitForDebuggerOnStart: true` and resumes after `network.start()`.
- `#handleAttached` (1803–1890):
  - Resumes every other target category.
  - Computes `named` at 1842.
  - Publication only sets `#iframes` and emits `session`. It has no commit step and no readiness read.
  - An enable failure detaches the target without resuming it.

**I5, tests**
- `tests/setup.ts`: removed `BROWSER_PUBLICATION_READINESS`, the `complete` option and its remark and evaluate branch. Added a `Runtime.runIfWaitingForDebugger` reply to both `scriptBrowserElements` (1057) and `scriptCDPAttach` (1639).
- `tests/setup.test.ts`: 469–472 proves the attach handshake answers the resume. The case at 1142 is renamed "...the resume of a paused target..." and asserts the reply at 1160 in place of the readiness proofs.
- `tests/src/core/BrowserPage.test.ts`:
  - 1981 (worker): the method order is `['Runtime.enable','Runtime.runIfWaitingForDebugger']`.
  - 2024 (popup): the full method list ends with `Network.enable` then the resume, and the auto-attach uses `waitForDebuggerOnStart: true`.
  - 2290 (setup fails): no `Runtime.runIfWaitingForDebugger` is sent to a target that failed to enable.
  - 2470 (enable test): the order is enables, lifecycle, auto-attach, resume, `Page.getFrameTree`, and the params use `true`.
  - 3652: the natural case, which replaces the recovery case.
  - 3752 (nested): no commit after publication until `session-nested` reports `Page.frameNavigated` with `loader-inner`.
  - 3903, 4003 and 4092 (the A1, I1 and I2 orderings): these attach without `parentFrameId` so a tree read still happens, and they have no readiness replies. 4092 is renamed "reports no load for a reported document when its frame tree or a later start names a newer one".
  - 4220: renamed "resumes a frame session and reads its frame tree only after its lifecycle events and auto-attach are in effect". Before the auto-attach reply, the session's methods are the four enables; at the end they are `['Runtime.runIfWaitingForDebugger','Page.getFrameTree']`.
- `tests/src/core/BrowserToolset.test.ts`:
  - 1564 (session moves): the local arrangement drops `roots` and `complete` and emits the real `commit` then `load` on the second session in both arrangements.
  - 2199: see D-I5-2.

**I3, `BrowserToolset.test.ts` nested `_parent` row (about 1412–1474).** The row releases request and start, asserts pending, releases commit, asserts pending, then releases load and asserts the receipt.

**I4, `BrowserToolset.test.ts` held-edit case (1192 onward).** The case catches the edit's rejection immediately (`.catch(error => error)`), and its teardown settles the outstanding actions.

### Claims (continuing from 16)
- **17 (I1):** A document reported through a same-document navigation while the frame is attaching gets no different-document commit at publication, because publication emits no commit. The record stays `requested` at B until B's own commit and load (`BrowserPage.test.ts:4003`).
- **18 (I2):** No load is emitted for a retained loader when the tree names a newer document or a newer start follows publication, because publication emits no load. B completes only from its own commit then load (4092).
- **19 (I3):** The nested `_parent` row checks each stage separately, and n5 reddens it (details under Mutations).
- **20 (I4):** The held-edit case fails under a2 on its one condition with no unhandled error (details under Mutations).
- **21 (I5 (1)):** Every child target pauses until the page has enabled it and then resumes it.
  - A frame session goes through the four enables, then the resume, then a tree read only when no parent was named (2470, 4220).
  - A worker is resumed after `Runtime.enable` (1981).
  - A popup is resumed after its domains and network (2024).
  - A target whose enable fails is detached and never resumed (2290, and "emits no session when the iframe domain enable fails").
- **22 (I5 (2)):** Publication reads the frame tree only for the parent, URL and name of a frame whose `parentFrameId` was absent. At 3652 the named parent gives a method list without `Page.getFrameTree`; at 4220 the unnamed parent gives the tree read after the resume.
- **23 (I5 (3), the natural case at 3652):**
  - A child is attached paused with its enable held; the record stays `requested` and the session's only method is `Page.enable`.
  - After the enable is released, the session is published, the list ends with `Runtime.runIfWaitingForDebugger`, and the record is still `requested`, so nothing was synthesized.
  - `frameNavigated` with `loader-field` on the new session gives `committed`, then lifecycle `load` gives `loaded`, and the parent is `main`.
- **24 (I5 (5), live P2 through the page's attach).** The probe built a `BrowserPage` as `BrowserContext` builds one, with `waitForDebuggerOnStart: true`, on Chromium 141 (chromium-1194) with `--site-per-process`. It navigated to `/frame/local` and submitted the in-process voucher form to `localhost`. The tape order was:
  - `#65` page `frameStartedNavigating` (loader `2A39…`)
  - `#68` page `Target.attachedToTarget`
  - `#69`–`#80` the new session's `Page.enable`, `Runtime.enable`, `Page.setLifecycleEventsEnabled` and `Target.setAutoAttach`, with their replies
  - `#81` resume sent
  - `#84` new session `Page.frameNavigated` (loader `2A39…`)
  - `#87` resume reply
  - `#88` page `frameDetached swap`
  - `#93` new session lifecycle `load` (loader `2A39…`)

  The record settled `{"url":"http://localhost:34837/frame/done?code=SAVE10&key=","stage":"loaded"}`. The commit arrives on the new session only after the resume, and it carries the navigation's loader. The probe is deleted.
- **25 (I5 (5), service run):** With the patch applied in a scratch copy, the voucher swap both ways and the nested `_parent` cases pass: 52 passed and 1 skipped in each of 3 consecutive runs.

### Mutations
Whole-file runs used scratch copies under `tmp/codex/c6-mutations/<name>/`, which were removed afterwards; each has a `.diff` and `.log`. None of the logs shows an unhandled error.

| Mutation | Change | Result | Failing assertion |
|---|---|---|---|
| i5 | resume dropped in `#enableFrameSession` | 3 failed, 137 passed | see the lines below |
| a2 (rerun) | edit not raced with the start | 1 failed, 100 passed: held-edit case | `BrowserToolset.test.ts:1225`, `Condition "the receipt settles while the insertion is withheld" did not hold within 3000ms` |
| n5 (rerun) | every destination frame made eligible | 1 failed, 100 passed: "waits for the parent frame navigation when Enter submits a nested form targeting _parent" | `BrowserToolset.test.ts:1473` `expect(performance.now() - loaded).toBeLessThan(1_000)`, which got 3838.8 |

i5's failing assertions:
- `BrowserPage.test.ts:2497` `expect(methods).toEqual([` (received 5 methods, expected 6)
- The natural case at `:3711` `expect([await record.settle({ timeout: 0 }), child()]).toEqual([` (the resume is missing, so the target never publishes its commit)
- `:4274` `).toEqual(['Runtime.runIfWaitingForDebugger', 'Page.getFrameTree'])`

The earlier i1 and i2 logs are kept as history (see D-I5-3).

### Validation (worktree root)

| Command | Exit | Result |
|---|---|---|
| `npx oxfmt --check` over the 8 touched files* | 0 | clean |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the same files | 0 | clean |
| `npm run check` | 0 | clean |
| `npm run test:src` | 0 | 58 files; 1190 passed, 1 skipped |
| `npm run test:setup` | 0 | 137 passed |
| `npm run test:policy` | 0 | 114 passed, 1 skipped |
| `npm run build` | 0 | built |
| `CHROME_PATH=… npm run test:service` in the worktree | 1 | 4 failed, 48 passed, 1 skipped (see D-I5-1) |
| same, scratch copy with the patch (`dist` linked) | 0 | 52 passed, 1 skipped, ×3 |
| `src:core` and `tsc` for the core config, scratch copy with the patch | 0 | 804 passed |

\* The touched files are `src/core/{BrowserPage,BrowserToolset,BrowserNavigationRecord}.ts`, `tests/setup.ts`, `tests/setup.test.ts` and `tests/src/core/{BrowserPage,BrowserToolset,BrowserRegistry}.test.ts`.

Logs are in `tmp/codex/c6-i5-*.log` and `tmp/codex/c6-mutations/c6-i5-*-patched*.log`.

### Shared-file patch: `src/core/BrowserContext.ts`
The same patch is saved at `/home/user/browser/tmp/worktrees/c6/tmp/codex/c6-browsercontext.patch`. No test pins the old value.
```diff
--- a/src/core/BrowserContext.ts
+++ b/src/core/BrowserContext.ts
@@ -506,7 +506,7 @@ export class BrowserContext implements BrowserContextInterface {
 	async #configurePage(page: BrowserPage): Promise<void> {
 		await page.send('Target.setAutoAttach', {
 			autoAttach: true,
-			waitForDebuggerOnStart: false,
+			waitForDebuggerOnStart: true,
 			flatten: true,
 		})
 		await page.send('Page.setInterceptFileChooserDialog', { enabled: true })
```

### Deleted members, for the guide unit
All in `BrowserPage.ts`:
- The `#documents` map, replaced by `#loaders`, which holds only the loader for the stop rule.
- `#readReadiness`, along with the page's readiness evaluation.
- The commit emitted during publication in `#handleAttached`.
- `#readFrameTree`'s loader recovery and its commit result.
- The loader delete at attach time.
- The routed handler's document record (the I1 retention).

In the test fixtures, the `BROWSER_PUBLICATION_READINESS` export and `BrowserElementFixtureOptions.complete` are removed from `tests/setup.ts`.

### Failing-first evidence
I wrote the I5 tests against the applied change, so their red-first evidence is the i5 mutation. It reddens the natural case (3652), the enable-order case (2470) and the resume-then-tree case (4220).

### Diffstat
The cumulative worktree diff against `5179859` is 21 files, +4038 and −1011, plus the new `src/core/BrowserNavigationRecord.ts` and `tests/src/core/BrowserNavigationRecord.test.ts`. This round touched `BrowserPage.ts`, `tests/setup.ts`, `tests/setup.test.ts`, `BrowserPage.test.ts` and `BrowserToolset.test.ts`.

# Third fix round (I6 to I11)

## Readings

**P8: a paused target stays paused after detach.** The run used Chromium 141.0.7390.37 with `--site-per-process`, probe `tmp/probes/c6-attach.test.ts`, output in `tmp/probes/logs/c6-attach-run.txt`, report in `tmp/units/c6-probe-report.md` § P8.
- **Detach without a resume:** the child is attached at #29 with `waitingForDebugger=true` and detached at #30–#32. After 2 s no beacon has arrived, the parent's `readyState` is still `interactive`, and the parent's `Page.getFrameTree` names the child with the URL `:`.
- **Control, resume then detach:** the resume is sent at #80, the swap arrives at #82, and the resume is answered at #83. The detach follows at #84–#86 and the parent loads at #90. The beacon arrives and the parent reaches `complete`.

**P2b: the page's own attach, with the full tape in `tmp/probes/logs/c6-attach-p2b.txt` (43 frames).** Report: `tmp/units/c6-probe-report.md` § P2b. Wire positions:
- #190: page `frameStartedNavigating`, loader L1.
- #195: page `Target.attachedToTarget`, child `c5`, `waitingForDebugger=true`.
- #196–#209: the `c5` commands and replies — `Page.enable` 196/199, `Runtime.enable` 200/201, `Page.setLifecycleEventsEnabled` 202/207, `Target.setAutoAttach` 208/209. A replayed lifecycle `commit` with a foreign loader arrives at #203.
- #210: resume sent.
- #213: `c5` `Page.frameNavigated`, loader L1.
- #215: page `frameDetached swap`.
- #218: resume reply.
- #222: `c5` lifecycle `load`, loader L1.

The record settled `{"url":"http://localhost:34031/frame/done?code=SAVE10&key=","stage":"loaded"}`.

## Changes by prescription

- **I6.** P8 answered "stays paused", so the page resumes a target before it detaches it.
  - `src/core/BrowserPage.ts:1451–1460`: `#detachChild` calls `#resumeTarget(session)` before `Target.detachFromTarget`. That covers the frame-enable failure continuation (1898), `#attachWorker`'s closed-page and failure paths (1296, 1305), and the popup closed, held and duplicate paths (1350, 1355, 1836).
  - `:1390–1393`: the popup setup-failure catch resumes before `popup.destroy()`.
  - `:1257–1264`: the `#resumeTarget` comment says that a detach alone leaves the target waiting, so a target the page cannot enable runs uninstrumented rather than frozen.
  - `tests/src/core/BrowserPage.test.ts:2302` is renamed "resumes, then detaches through the page session, a child frame or worker session whose setup fails, and enables it no further". It asserts `readCDPSessionMethods` for each session: `['Page.enable','Runtime.runIfWaitingForDebugger','Target.detachFromTarget']` and `['Runtime.enable','Runtime.runIfWaitingForDebugger','Target.detachFromTarget']`.
  - `:2261` is renamed "resumes, then detaches on its opener session, a popup whose setup fails" and asserts the resume, then the detach.
- **I7.** `tmp/probes/c6-attach.test.ts`: the P2b case builds `BrowserPage` as `BrowserContext.#configurePage` builds a page (auto-attach with `waitForDebuggerOnStart: true`, the file chooser, lifecycle, then `network.start()`). It writes the tape to `tmp/probes/logs/c6-attach-p2b.txt` and asserts only the precondition, which is `loaded` at the destination URL.
- **I8.**
  - `src/core/BrowserPage.ts:1561–1574`: `#handleSessionNavigated` passes `url` and `name` to `#updateFrame`. The name is the reported string; an empty or absent name becomes `undefined`, as `readBrowserFrames` normalizes it.
  - `:1642–1655`: `#updateFrame` replaces `#updateFrameURL` and spreads the update onto both the attaching record and the published record.
  - `:1576–1583`: the routed handler passes only `url`, so a same-document navigation keeps the name.
  - `#handleFrameNavigated` for page-session reports is unchanged: page-session names come from `Page.getFrameTree` in `frames()`.
  - Test at `tests/src/core/BrowserPage.test.ts:4446` (`it.each` before or after publication): a named-parent attach, then the session's `Page.frameNavigated` with `name: 'checkout'`. `page.frame('checkout')` resolves to `child` at `https://other.test/checkout`. On the previous tree it returned `undefined`; see the i8 row under Mutations.
- **I9.** Successful attach arrangements answer `Runtime.runIfWaitingForDebugger`:
  - The shared handshakes `scriptBrowserElements` (`tests/setup.ts:1074`) and `scriptCDPAttach` (`:1656`) answer it.
  - 23 `BrowserPage.test.ts` arrangements and 3 `BrowserRegistry.test.ts` arrangements answer it inline.
  - The review's `BrowserPage.test.ts:2089` (discovered popup) and `:2554` (swap) are answered, and so is `BrowserRegistry.test.ts:543`. That last one is the C8 list at `:552–554`, plus G1 and G3.
  - Evidence: I ran a scratch copy (`src:core` 806 passed) whose test transport counts every sent and answered resume after each test. That count includes 189 tests that attach a target; they sent 213 resumes, and every one was answered. Log: `tmp/codex/c6-i9-audit-all.log`.
- **I10.**
  - The natural case's local `child` function is removed. Its call sites use `readCDPSessionMethods(transport, 'session-child')`, a module-level helper in `tests/setup.ts:736–752`. It lists the methods sent on a session and those naming it as `sessionId`, and is proved at `tests/setup.test.ts:438`.
  - The same helper replaces the per-session projections at `BrowserPage.test.ts:2015`, `:2070`, `:2350`, `:2511`, `:3729`, `:3736`, `:4280`, `:4291` and `:4335`.
  - The two older hits in owned files are removed as well:
    - `creationCount` became `readCDPParams(transport, 'Page.createIsolatedWorld')` at `:1052–1058` (three `toHaveLength` assertions).
    - The shared `reference` counter became the module-level factory `createReferenceSequence` at `:64–68` (comment and function), used at `:2151`.
- **I11.** Test at `tests/src/core/BrowserPage.test.ts:4300`, a frame session with no `parentFrameId` whose resume reply is withheld:
  - The session is published, and its methods end with `Runtime.runIfWaitingForDebugger`, `Page.getFrameTree`. Parent `main` is read from the tree.
  - Answering the resume then sends nothing further.

## Claims (continuing from 25)

- **26 (I6).** A target the page detaches is resumed first, so a paused target is never left frozen. P8 shows a detach alone leaves it paused: no beacon, and the parent stuck at `interactive`. The resume-then-detach control shows that it runs.
  - Pinned for frames and workers at 2302 and for popups at 2261.
  - i7 (the resume removed from `#detachChild`) reddens 2302.
- **27 (I7).** Through the page's own attach, the new frame session's commit (#213, loader L1) follows the page's resume (#210). The page-session swap (#215) and the session's `load` (#222, L1) follow the commit, and the record settles `loaded`. The tape is retained.
- **28 (I8).** A named-parent frame is found by the name its session commit reports, whether the commit arrives before or after publication. The i8 check (the name dropped) reddens both rows.
- **29 (I9).** Every `src:core` arrangement that attaches a target answers every resume the page sends. The audit counts 189 tests and 213 resumes, all answered. The sweep that follows rules each attach hit.
- **30 (I10).** No function is declared inside a test body or method in the owned source and test files. The only remaining hits are JavaScript source text inside a string and the U0 probe (see the sweep).
- **31 (I11).** The resume is sent without waiting: publication and the tree read go ahead with the resume unanswered. i6 (the resume awaited) reddens the I11 case.

The earlier record also needs a correction. Mutation n5 (claim 19) resolves each named destination frame to itself; "every destination frame made eligible" was inaccurate.

## Sweep 1 (I9): `grep -n "Target.attachedToTarget" tests/`

There are 69 hits. Every hit that sends a resume is answered: none is left unanswered, and no arrangement withholds the resume without answering it. The answered counts come from `tmp/codex/c6-i9-audit-all.log`.

| Hit | Test | Arrangement | Ruling |
| --- | --- | --- | --- |
| `tests/setup.ts:444` | - | fixture internals | the doc comment on the test transport; nothing to answer |
| `tests/setup.ts:547` | - | fixture internals | the transport's session bookkeeping; nothing to answer |
| `tests/setup.ts:1350` | - | shared handshake | `attachBrowserElementChild` emits the attach; `scriptBrowserElements` answers the resume (setup.ts:1074) |
| `tests/src/core/elements/BrowserElementManager.test.ts:422` | catches ignoring a detached out-of-process child frame | shared handshake | answered: 2 of 2 resumes |
| `tests/src/core/elements/BrowserElementManager.test.ts:447` | catches a retired frame session invalidating the references its replacement captured | shared handshake | answered: 2 of 2 resumes |
| `tests/src/core/BrowserRegistry.test.ts:560` | C8 disables every enabled session and rejects in-flight invocations on destroy | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserRegistry.test.ts:663` | G1 stops the child loop when destroy runs during start | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserRegistry.test.ts:714` | G3 keeps the registry running when a child enable fails during start | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserRegistry.test.ts:737` | G3 keeps the registry running when a child enable fails during start | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserPage.test.ts:897` | follows an out-of-process frame on its own session until it detaches | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:955` | marks a reading stale when frame detachment arrives on the iframe session | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:1041` | scopes a context clear to the session that emitted it | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:1507` | routes out-of-process iframe operations through the attached child session | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:1541` | falls back to the page session after an iframe child target detaches | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2003` | promotes and resumes attached worker targets after enabling their Runtime session | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2051` | creates popup pages with opener identity and initialized protocol domains, and resumes the | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2248` | publishes the popup of a page constructed directly with an opener and no ready | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2279` | resumes, then detaches on its opener session, a popup whose setup fails | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2317` | resumes, then detaches through the page session, a child frame or worker session whose set | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserPage.test.ts:2325` | resumes, then detaches through the page session, a child frame or worker session whose set | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserPage.test.ts:2502` | emits session after both domains enable, lists the frame beside the tree, and drops it on  | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2555` | emits no session when the iframe domain enable fails | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2587` | catches a swap detach between the attach and its enable completion dropping the frame sess | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2623` | catches a swap detach before the attach emitting detach or dropping the frame session | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2655` | catches a remove detach between the attach and its enable completion keeping the frame ses | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2720` | catches the frame list keeping the attach URL after the frame session navigates | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2764` | catches the attach continuation overwriting a navigation that preceded its enable completi | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2800` | catches a navigation of another frame overwriting the out-of-process frame URL | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2852` | catches the frame list keeping the attach URL when the first commit preceded the frame ses | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2895` | catches a frame tree refusal between the enable and the read blocking publication | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2938` | catches the frame tree snapshot overwriting a newer navigation delivered in the same read | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:2975` | catches a superseded session detach deleting the frame its replacement owns | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserPage.test.ts:2981` | catches a superseded session detach deleting the frame its replacement owns | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserPage.test.ts:3022` | catches a superseded session navigation overwriting the URL its replacement owns | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserPage.test.ts:3032` | catches a superseded session navigation overwriting the URL its replacement owns | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserPage.test.ts:3070` | catches a same-document navigation of the frame session leaving its listed URL stale | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:3609` | reports a frame session load by its loader and a stop only after a commit that named no lo | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:3712` | settles an out-of-process frame navigation from the commit and load its session reports af | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:3821` | ignores a commit and stop from the session a nested frame left for its own session | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserPage.test.ts:3848` | ignores a commit and stop from the session a nested frame left for its own session | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserPage.test.ts:3946` | keeps a navigation that starts while its frame publishes from completing on the document t | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:4046` | publishes no commit for a document its session reported through a same-document navigation | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:4136` | reports no load for a reported document when its frame tree or a later start names a newer | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserPage.test.ts:4264` | resumes a frame session and reads its frame tree only after its lifecycle events and auto- | inline | answered: 1 of 1 resumes |
| `tests/src/core/BrowserPage.test.ts:4322` | reads the frame tree and publishes a frame session without waiting for its resume reply, a | inline | withheld on purpose, then answered: the I11 case (added after the audit run) |
| `tests/src/core/BrowserPage.test.ts:4390` | publishes a nested frame that attaches through its parent session while the parent publica | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserPage.test.ts:4404` | publishes a nested frame that attaches through its parent session while the parent publica | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserPage.test.ts:4473` | publishes a nested frame that attaches through its parent session while the parent publica | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserPage.test.ts:4536` | names a published frame parent from its target and leaves an unnamed parent unknown | inline | answered: 2 of 2 resumes |
| `tests/src/core/BrowserToolset.test.ts:1625` | settles a child navigation whose commit and load arrive after the frame moves %s, and leav | shared handshake | answered: 1 of 1 resume in each of the 2 rows |
| `tests/src/core/BrowserToolset.test.ts:2211` | refuses a click whose document was replaced after the observer installed | shared handshake | answered: 2 of 2 resumes |
| `tests/src/core/BrowserToolset.test.ts:3060` | catches a popup that leaves the view behind, a receipt that omits the move, a close that s | shared handshake | answered: 2 of 2 resumes |
| `tests/src/core/BrowserToolset.test.ts:3262` | catches an adoption that lands after a newer change, a view move, a move and return, or de | shared handshake | answered: 2 of 2 resumes |
| `tests/src/core/BrowserToolset.test.ts:4028` | catches registry tools that stay behind when the view moves to a popup | shared handshake | answered: 2 of 2 resumes |
| `tests/src/core/BrowserToolset.test.ts:4196` | catches a continuation offset that counts the move note instead of the reading | shared handshake | answered: 2 of 2 resumes |
| `tests/src/core/BrowserToolset.test.ts:4517` | catches an adoption begun on the opener that lands after a move to a popup and back | shared handshake | answered: 2 of 2 resumes |
| `tests/src/core/BrowserContext.test.ts:125` | applies context emulation before adopting and emitting a popup page | shared handshake | answered: 1 of 1 resumes |
| `tests/src/core/BrowserContext.test.ts:526` | publishes a popup discovery reports before its attachment event once and detaches the seco | shared handshake | answered: 2 of 2 resumes |
| `tests/src/core/BrowserContext.test.ts:574` | publishes a popup whose attachment event precedes discovery once, without a second attach | shared handshake | answered: 1 of 1 resumes |
| `tests/setup.test.ts:357` | frames an event with defaulted parameters and an optional session | raw transport | proves event framing; no page, so no resume is sent |
| `tests/setup.test.ts:366` | frames an event with defaulted parameters and an optional session | raw transport | proves event framing; no page, so no resume is sent |
| `tests/setup.test.ts:539` | answers discovery, an attach to a mapped target with its own session, and that session wit | raw client | proves the attach handshake's session bookkeeping; no page, so no resume is sent |
| `tests/setup.test.ts:612` | admits only the first reply to an attach request and forgets every session when the connec | raw client | proves the attach handshake's session bookkeeping; no page, so no resume is sent |
| `tests/setup.test.ts:621` | admits only the first reply to an attach request and forgets every session when the connec | raw client | proves the attach handshake's session bookkeeping; no page, so no resume is sent |
| `tests/setup.test.ts:1150` | attaches the child frame on its own session under the main frame and waits for its publica | shared handshake | answered by `scriptBrowserElements` (setup.ts:1074) |
| `tests/setup.test.ts:1152` | attaches the child frame on its own session under the main frame and waits for its publica | shared handshake | answered by `scriptBrowserElements` (setup.ts:1074) |
| `tests/service/browser.test.ts:705` | records and replays a contenteditable fill through codegen on a real DOM | live browser subscription | real Chromium answers; not a fixture |
| `tests/service/toolset.test.ts:484` | names the beforeunload dialog in a link click receipt, and the accepted dialog commits the | live browser subscription | real Chromium answers; not a fixture |
| `tests/service/toolset.test.ts:631` | returns the destination view in the receipt of a type with submit that navigates an out-of | live browser subscription | real Chromium answers; not a fixture |

## Sweep 2 (I10): local functions

Pattern (extended regex, over every owned file): `^\s+(const|let) NAME(: TYPE)? = (async )?(PARAMS|IDENT)( *:TYPE)? *=>` and `^\s+(async )?function\*? *NAME\(`.

| Hit | Ruling |
| --- | --- |
| `tests/src/core/BrowserPage.test.ts:3669` `const child = ...` | removed (I10), replaced by `readCDPSessionMethods` |
| `tests/src/core/BrowserPage.test.ts:1043` `const creationCount = ...` | removed, replaced by `readCDPParams(...).length` assertions |
| `tests/src/core/BrowserPage.test.ts:2144` `const reference = ...` | removed, replaced by the module-level factory `createReferenceSequence` |
| `tests/setup.ts:55–59` and `:99–102` `const requestAnimationFrame = () => 0`, and others | JavaScript source text inside a template string passed to `new Function`; data, not a declaration |
| `tmp/probes/c6-attach.test.ts` | none: `recordTapeFrame` and `createDetacher` are module-level |
| `tmp/probes/c6-navigation.test.ts` (42 hits) | left unchanged: the U0 probe's recorded instrument, which no gate collects; editing it would change the evidence behind the U0 readings |

After the changes, the sweep over `src/core/BrowserPage.ts`, `src/core/BrowserToolset.ts`, `src/core/BrowserNavigationRecord.ts`, `tests/setup.ts`, `tests/setup.test.ts` and `tests/src/core/{BrowserPage,BrowserToolset,BrowserRegistry,BrowserNavigationRecord}.test.ts` returns only the `tests/setup.ts` string hits.

## Mutations

The runs were whole-file on scratch copies under `tmp/codex/c6-mutations/`, which were removed afterwards; each has a `.diff` and `.log`. No log shows an unhandled error.

| Mutation | Change | Result | Failing assertion |
| --- | --- | --- | --- |
| i6 | `#resumeTarget` awaits the resume, and `#enableFrameSession` awaits it | 1 failed, 142 passed: the I11 case | `BrowserPage.test.ts:4329` `await waitForCondition(` 'the frame is published with its resume unanswered' did not hold within 1000 ms |
| i7 | the resume removed from `#detachChild` | 1 failed, 142 passed: the I6 case at 2302 | `BrowserPage.test.ts:2351` `).toEqual([` (received `['Page.enable','Target.detachFromTarget']`, expected the resume between) |
| i8 (the I8 red-first check) | the reported name dropped from the session commit | 2 failed, 141 passed: both rows of 4446 | `BrowserPage.test.ts:4491` `expect([found?.id, found?.url, found?.name]).toEqual([` (received `[undefined, undefined, undefined]`) |

## Validation (from the worktree root)

| Command | Exit | Result |
| --- | --- | --- |
| `npx oxfmt --check` over the 5 touched source and test files | 0 | clean |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the same files | 0 | clean |
| `npm run check` | 0 | clean |
| `npm run test:src` | 0 | 58 files; 1193 passed, 1 skipped |
| `npm run test:setup` | 0 | 138 passed |
| `npm run test:policy` | 0 | 114 passed, 1 skipped |
| `npm run build` | 0 | built |
| `CHROME_PATH=… npm run test:service` run 1 | 0 | 52 passed, 1 skipped |
| `CHROME_PATH=… npm run test:service` run 2 | 0 | 52 passed, 1 skipped |
| `CHROME_PATH=… npm run test:service` run 3 | 0 | 52 passed, 1 skipped |
| `npm run test:probe` restricted to `tmp/probes/c6-attach.test.ts` | 0 | 3 passed; P8 both rows and P2b, traces in `tmp/probes/logs/c6-attach-run.txt` |

The touched files are `src/core/BrowserPage.ts`, `tests/setup.ts`, `tests/setup.test.ts`, `tests/src/core/BrowserPage.test.ts` and `tests/src/core/BrowserRegistry.test.ts`; the new probe was also formatted through stdin. Logs are `tmp/codex/c6-fix3-*.log`.

## Deviations

- **D-I6-1: the resume sits in `#detachChild` rather than only in the two named failure paths.** P8 applies to every paused target the page detaches, including the paths the brief didn't name: a duplicate popup claim, a popup held elsewhere, a page that closed while a worker was enabling, and a failed popup setup (`popup.destroy()`). One placement covers every child detach. The popup `destroy` path needs its own resume, at `:1392`, because it detaches the popup's own session. The brief's named paths behave as prescribed, and i7 is the mutation.
- **D-I9-1: no edit was needed outside the owned list.** The attach hits in `BrowserContext.test.ts`, `BrowserElementManager.test.ts`, `BrowserPageElement.test.ts`, `factories.test.ts` and `helpers.test.ts` are answered by the shared handshakes. The audit shows every resume those tests send is answered.
- **D-I10-1:** `tmp/probes/c6-navigation.test.ts` keeps its 42 local functions, for the reason in Sweep 2.
- **Probe placement:** `tmp/probes/c6-attach.test.ts` serves P8 from its own `node:http` server (the `/p8/outer`, `/p8/child` and `/p8/beacon` routes). `tests/setupServer.ts` has no beacon route and is outside the owned list.
- **Mutation evidence:** the i6 red is a `waitForCondition` timeout on publication, because an awaited resume never publishes while its reply is withheld. It is not an `expect` mismatch.

# Fourth fix round (I12 to I15)

Claim 26 is now backed by the code: the page detaches a paused target only after the resume's reply arrives. The U0 probe is rewritten and its rerun matches the recorded answers except for P5's timing. The reference factory is a shared setup export, and the beacon server binds `127.0.0.1`. All gates are green.

## Changes by prescription

- **I12: the detach waits for the resume's reply.**
  - `src/core/BrowserPage.ts:1265–1272`, `#releaseTarget` (new): awaits `Runtime.runIfWaitingForDebugger` on the session and ignores a refusal. Its comment gives the reason: the reply shows the renderer processed the resume before the browser processes the detach.
  - `:1459–1468`: `#detachChild` awaits `#releaseTarget` before it sends `Target.detachFromTarget`.
  - `:1400`: the failed popup setup awaits `#releaseTarget` before `popup.destroy()`.
  - `:1257–1263`: `#resumeTarget` stays fire-and-forget for the paths where no detach follows: `#enableFrameSession`, the success paths of `#attachWorker` and `#attachPopup`, and the other target categories.
  - Tests in `tests/src/core/BrowserPage.test.ts`, each run with the resume answered and with it refused:
    - `:2259`, "destroys a popup whose setup fails only after its resume is %s": while the resume's reply is withheld, nothing follows the resume on the wire. After the reply, the detach arrives on `session-1` and `popup-child` ends with the resume, then the detach.
    - `:2316`, "detaches through the page session a child frame or worker session whose setup fails only after its resume is %s, and enables it no further": while both replies are withheld, no `Target.detachFromTarget` is sent. After the replies, both detaches follow, with each session's sequence being enable, resume, detach.
- **I13: the U0 probe under the function rule.** `tmp/probes/c6-navigation.test.ts` is rewritten (1256 lines after formatting):
  - The helpers that were declared inside `describe` are now methods of a module-level class `NavigationProbe` (`:254`). Its fields are `fixtures`, `client`, `tape` and `answers`, and `beforeAll` constructs it.
  - Seven inner functions move to module level: `recordTapeFrame` (`:148`), `aliasId` (`:220`), `selectRows` (`:233`), `listLoaders` (`:237`) and `placeEvent` (`:243`). The frame-target lister and the tree walker become the methods `listFrameTargets`, `printFrameTree` and `walkFrameTree`.
  - The readings' logic and printed shape are unchanged.
  - To pass lint, each test asserts how many answers its reading produced (P2 5, P3 4, P4 2, P5 5 per series, P6 3, P7 3). The in-method `expect` became a thrown precondition, and the unused `browser` variable is removed.
  - The rerun output is `tmp/probes/logs/c6-navigation-rerun.txt`; the comparison is in `tmp/units/c6-probe-report.md` § U0 rerun and in the next section.
- **I14: the reference factory is in the shared setup.**
  - `tests/setup.ts:721–736`: `createReferenceSequence` is exported with TSDoc (third-person summary, `@returns`, `@example`).
  - `tests/setup.test.ts:439` proves it: `[first(), first(), second(), first(), second()]` gives `['e1','e2','e1','e3','e2']`.
  - `tests/src/core/BrowserPage.test.ts:45` imports it, and it is used at `:2145`. The test file no longer declares it.
- **I15: the beacon server's bind.**
  - `tmp/probes/c6-attach.test.ts:265` calls `server.listen(0, '127.0.0.1', resolve)`.
  - The P2b precondition is a single `toEqual` on the settled record.
  - The probe was rerun after I12. Its outputs replace `tmp/probes/logs/c6-attach-run.txt` and `c6-attach-p2b.txt`, and the positions in `c6-probe-report.md` § P8 and § P2b are updated.

## Claims (continuing from 31)

- **32 (I12).** The page detaches a target only after the resume's reply, whether the reply is a success or a refusal. It destroys a failed popup under the same rule. This matches the P8 control's order: resume #79, reply #82, detach #83, then the beacon arrives and the parent completes.
- **33 (I12).** The rerun readings are unchanged:
  - P8, detach without a resume: attach #29, detach #30–#34, no beacon after 2 s, parent `interactive`.
  - P2b: start #186, attach #191, the `c5` enables #192–#208, resume #209, `frameNavigated` L1 #212, swap #214, resume reply #217, `load` L1 #221.
  - P2b settled `loaded` at `http://localhost:44489/frame/done?code=SAVE10&key=`, with 54 tape frames.
- **34 (I13).** The rewritten U0 probe reproduces the recorded answers for P1, P2, P3, P4, P6 and P7. P5's qualitative answer holds for the form series: the start follows the input reply in all 10 repetitions. The two timing differences are listed in the next section.
- **35 (I14).** Each provider numbers its own references and advances by one per call; two providers are independent.

## U0 comparison

Details are in `tmp/units/c6-probe-report.md` § U0 rerun. P1, P2, P3, P4, P6 and P7 are equal; P2 and P7 differ only in wire positions. P5 differs in two places:
- **Enter series:** `frameRequestedNavigation` arrives +0.37 to +1.11 ms after the `keyDown` reply in all 5 repetitions. The record said "within ±0.4 ms", with 4 after and 1 before.
- **Link control:** repetitions 3 and 5 have `frameStartedNavigating` after the reply (+1.96 and +2.69 ms); the record had all 5 before.

The mouse series is 5 before, within 0.25 ms (recorded 3 before and 2 after).

## Sweep

The pattern, run over `tmp/probes/c6-navigation.test.ts` and `tmp/probes/c6-attach.test.ts`:
- `^\s+(const|let) [A-Za-z_]+(: [^=]+)? = (async )?(\([^)]*\)|[a-z]+)( *:[^=]*)? *=>|^\s+(async )?function\*? *[A-Za-z_]+\(`: 0 hits in each file.
- The broader `(const|let) \w+[^=]*= (async )?(\(|function|\w+ =>)`: 2 hits, both non-functions. One is JavaScript text inside a template string (`c6-navigation.test.ts`, the `center` expression). The other is an `await` expression (`c6-attach.test.ts:395`).

## Mutation

The run used a scratch copy under `tmp/codex/c6-mutations/i9/`, which was removed afterwards; its `.diff` and `.log` are kept. The log shows no unhandled error.

| Mutation | Change | Result | Failing assertion |
|---|---|---|---|
| i9 | `await this.#releaseTarget(session)` changed to `void this.#releaseTarget(session)` at both sites (`#detachChild` and the popup catch) | 4 failed, 141 passed: both rows of `:2259` and both rows of `:2316` | `BrowserPage.test.ts:2289` `expect(transport.sent.slice(transport.sent.indexOf(resume) + 1)).toEqual([])` received the destroy traffic. `:2352` `).toEqual([])` received both `Target.detachFromTarget` messages while the resumes were withheld |

## Validation (from the worktree root)

| Command | Exit | Result |
|---|---|---|
| `npx oxfmt --check`, 6 touched files | 0 | clean |
| `npx oxlint --config .oxlintrc.json --deny-warnings`, same files | 0 | clean |
| `npm run check` | 0 | clean |
| `npm run test:src` | 0 | 1195 passed, 1 skipped |
| `npm run test:setup` | 0 | 139 passed |
| `npm run test:policy` | 0 | 114 passed, 1 skipped |
| `npm run build` | 0 | built |
| `test:service`, run 1 (with `CHROME_PATH` set) | 0 | 52 passed, 1 skipped |
| `test:service`, run 2 | 0 | 52 passed, 1 skipped |
| `test:probe`, `c6-navigation.test.ts` | 0 | 7 passed |
| `test:probe`, `c6-attach.test.ts` | 0 | 3 passed |
| `tsc` with a temporary config over both probe files (deleted after use) | 0 | clean |

The 6 touched files are `src/core/BrowserPage.ts`, `tests/setup.ts`, `tests/setup.test.ts`, `tests/src/core/BrowserPage.test.ts`, `tmp/probes/c6-navigation.test.ts` and `tmp/probes/c6-attach.test.ts`. Logs: `tmp/codex/c6-fix4-*.log`, `tmp/probes/logs/c6-navigation-rerun.txt`, `tmp/probes/logs/c6-attach-run.txt`.

## Deviations

- **U0 probe assertions (I13):** "keep the readings' logic" is honored. The lint gate over the touched probe required three changes that don't change any reading: each test asserts its answer count, the in-method `expect` became a thrown precondition, and the unused `browser` holder and its `afterAll` `expect` are removed. The original file had the same 7 lint errors before the rewrite.
- **Recorded report format:** the recorded U0 report has no raw `answer:` lines, so the comparison sets each rerun `answer:` line against the recorded prose answer for its reading.
- Nothing else. No file outside the owned list was touched, and nothing was committed.

# Fifth fix round (I17)

Both probes now keep every function either at module level, as a class method, as an anonymous callback passed directly as an argument, or as an anonymous function returned directly. Both reruns reproduce the recorded answers; P5 differs on timing only. No tracked file was touched.

## Changes

- **`tmp/probes/c6-navigation.test.ts:185–221`:** the transport hooks that were object properties in `createTape` are now the methods of a module-level class, `RecordingTransport implements CDPTransportInterface` (`:186`). Its `start`, `send` and `close` methods and its `emitter` getter implement the interface. The private `#receive` method is registered through `this.#receive.bind(this)`. `createTape` (`:218`) now returns `{ transport, frames: transport.frames, labels }`, with no function in any property.
- **`tmp/probes/c6-navigation.test.ts:975–987` and `:1163`, `:1172`, `:1181`:** P5's three `act` property functions are now `NavigationProbe` methods: `clickAddToCart`, `submitNameByEnter` and `clickNextLink`. Each series passes the bound method reference, for example `act: probe.clickAddToCart.bind(probe)`. The readings' logic and printed output are unchanged.
- **`tmp/probes/c6-attach.test.ts:106–142`:** the same `RecordingTransport` class (`:107`) replaces the object-property hooks, and `createTape` (`:139`) returns `{ transport, frames: transport.frames }`.
- **`tmp/units/c6-probe-report.md`:** the `### P8`, `### P2b` and `### U0 rerun` sections are replaced with the fifth-round rerun's positions and comparison.
- **Logs:** the rerun output replaces `tmp/probes/logs/c6-navigation-rerun.txt`, `c6-attach-run.txt` and `c6-attach-p2b.txt`.

## Claim

- **36 (I17).** Neither probe file declares, assigns or places a function expression in an object property inside another function or method. The sweeps below find no hit except type annotations, ternary branches, control statements, constructors and permitted callbacks. With the changes in place, both probes reproduce their readings: U0 7 of 7, P8 both rows, and P2b settled `loaded`.

## Sweep (over `tmp/probes/c6-navigation.test.ts` and `tmp/probes/c6-attach.test.ts`)

| Pattern | Hits | Ruling |
|---|---|---|
| `:\s*(async )?\(` (property position) | nav `:234`, `:606`, `:610`; attach `:180`, `:207`, `:244`, `:435` | None is a function expression. nav `:234` is the `Series.act` type annotation, and nav `:606`, `:610` and attach `:244` are parameter or return type annotations. attach `:180`, `:207` and `:435` are the alternate branches of ternaries. |
| `:\s*(async )?function` | 0 | none |
| `^\s+\w+\s*\([^)]*\)\s*\{` (method shorthand) | nav `:165`, `:191`, `:277`, `:300`, `:487`, `:497`, `:646`, `:749`, `:992`, `:1097`; attach `:112`, `:147`, `:154`, `:169`, `:182` | None is inside an object literal. The hits are `if`, `switch` and `for` statements plus the two class constructors (nav `:191` and `:277`, attach `:112`). |
| Declaration: `^\s+(const\|let) NAME(: T)? = (async )?(PARAMS\|IDENT)( *:T)? *=>` or `^\s+(async )?function\*? *NAME\(` | 0 | none |
| Other positions: `:\s*(async )?\w+\s*=>`, `\[\s*(async )?\(`, `= (async )?\(`, `\?\s*(async )?\([^)]*\)\s*=>` | nav `:389`; attach `:414` | nav `:389` is JavaScript source inside a template string, which is data. attach `:414` is an `await` expression. |
| Every arrow: `=>\s*\{?\s*$\|=> [a-z]` | 88 lines (nav 60, attach 28) | Each is an anonymous callback passed directly as an argument (to `filter`, `map`, `find`, `some`, `then`, `catch`, `waitForCondition`, `teardown.add`, `subscribe`, `new Promise`, `it` or `beforeAll`) or returned directly (nav `:611`, `committed`; attach `:245`, `createDetacher`). This is allowed. |

## Rerun comparison

The full sections are in `tmp/units/c6-probe-report.md`: § P8, § P2b and § U0 rerun.

- **P8: equal.** The answer is `P8: a paused target stays paused after detach`.
  - Without a resume: attach #29, detach #30, `detachedFromTarget` #31, reply #32 (previously #33 and #34). No beacon arrives after 2 s, and the parent stays `interactive`.
  - Control: resume #80, reply #82, detach #83. One position moved: the page-session swap now arrives after the detach is sent (#86); it previously arrived before the resume's reply (#81). The beacon arrives and the parent reaches `complete`.
- **P2b: equal order, with new positions:**
  - #188 requested
  - #191 started
  - #196 attach
  - #197 to #210 the `c5` enables
  - #211 resume
  - #214 `frameNavigated` L1
  - #216 swap
  - #219 resume reply
  - #223 `load` L1
  - The record settled `loaded`, and the tape has 46 frames.
- **U0: P1, P2, P3, P4, P6 and P7 are equal.** P2 and P7 differ only in wire positions.
- **U0 P5:** the start follows the input reply in all 10 form repetitions. Three timing details differ:
  - The mouse series is back to 3 before and 2 after, within ±0.4 ms, as recorded.
  - The Enter series is 4 after and 1 before, as recorded, but every one of its five request deltas lies outside ±0.4 ms: +2.26, +0.85, +3.58, −13.59 and +0.45 ms in repetitions 1 to 5.
  - In the link control, repetitions 1, 2 and 5 have both events after the reply; the record had all 5 before.

## Validation (from the worktree root, `env -C /home/user/browser/tmp/worktrees/c6`)

| Command | Exit | Result |
|---|---|---|
| `npx oxfmt --check tmp/probes/c6-navigation.test.ts tmp/probes/c6-attach.test.ts` | 0 | clean |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the same two files | 0 | clean |
| `npx tsc -p tmp/probes/tsconfig.probe.json` (a temporary config extending `tsconfig.json`, removed afterwards) | 0 | clean |
| `npx vitest run --config vite.config.ts --no-cache --reporter=verbose --project probe tmp/probes/c6-navigation.test.ts` | 0 | 7 passed |
| `npx vitest run --config vite.config.ts --no-cache --reporter=verbose --project probe tmp/probes/c6-attach.test.ts` | 0 | 3 passed |

## Deviations

- **Formatting:** I formatted both probe files by piping each through `oxfmt --stdin-filepath` and copying the output back; I didn't run the `format` script or touch any tracked file.
- **Wider sweep:** beyond the patterns the brief names, I added two sweeps (the other positions and every arrow) and ruled each hit.
- **Scope:** nothing else changed. No tracked file, build, or index-wide git command was touched or run, and nothing was committed.

# Sixth fix round (I18)

I18 is in place: the three P5 methods have one-word names, both tape recorders expose their tape through a read-only getter, and the P5 comparison passages give the measured Enter deltas. I didn't rerun the probes: the changes are a rename and a type narrowing, and both files type-check, lint, and format-check clean.

## Changes

- **(a) O1, the P5 method names** (`tmp/probes/c6-navigation.test.ts`):
  - `clickAddToCart` is now `add` (`:979`).
  - `submitNameByEnter` is now `submit` (`:983`).
  - `clickNextLink` is now `follow` (`:988`).
  - Their bound references are `act: probe.add.bind(probe)` (`:1167`), `act: probe.submit.bind(probe)` (`:1176`), and `act: probe.follow.bind(probe)` (`:1185`).
- **(b) O2, the tape view:**
  - In `tmp/probes/c6-navigation.test.ts`, `RecordingTransport` keeps its tape in the private `readonly #frames: TapeFrame[]` (`:187`) and exposes `get frames(): readonly TapeFrame[]` (`:196`). `Tape.frames` is `readonly TapeFrame[]` (`:46`). Both calls to `recordTapeFrame` write to `this.#frames`.
  - `tmp/probes/c6-attach.test.ts` gets the same change: `#frames` at `:108`, the getter at `:117`, and `Tape.frames` as `readonly TapeFrame[]` at `:50`. Its consumers, `labelSessions` and `printTrace`, already take `readonly TapeFrame[]`.
- **(c) O3, the P5 numbers:**
  - `tmp/units/c6-probe-report.md:193` now gives the Enter request deltas from the rerun: +2.26, +0.85, +3.58, −13.59, and +0.45 ms in repetitions 1 to 5. All five lie outside ±0.4 ms. The passage keeps the 4-after, 1-before split and the conclusion that the start follows the reply.
  - `tmp/units/c6-settle-claims.md:708` states the same five values and keeps the split.
  - The fourth-round passage at `:616` is unchanged, because it describes that round's own run.

## Validation

All three commands ran from `env -C /home/user/browser/tmp/worktrees/c6`.

| Command | Exit |
|---|---|
| `npx oxfmt --check tmp/probes/c6-navigation.test.ts tmp/probes/c6-attach.test.ts` | 0 |
| `npx oxlint --config .oxlintrc.json --deny-warnings tmp/probes/c6-navigation.test.ts tmp/probes/c6-attach.test.ts` | 0 |
| `npx tsc -p tmp/probes/tsconfig.probe.json` (a temporary config that extends `tsconfig.json`, removed afterwards) | 0 |

## Deviations

None. I touched no tracked file, ran no build or `format`, and made no git write.
