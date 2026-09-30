# C6 settlement design, subjective lane (Opus `planner`, read-only, verbatim)

# C6 navigation settlement: subjective design lane

**Lane: subjective.** This covers API shape, vocabulary, ownership boundaries, and guide voice. The brief's Deliverable sets the order: Design holds parts (1) to (4), and Risks holds part (5).

## Design

**The decision.** The page gains one handle: `page.navigation.record(frame)`. It opens synchronously, immediately before the action's first input. It records the navigation steps the page accepts from then on, and then settles the navigation the action started.
- The page owns frames, sessions, loaders, parents, and ownership. It applies them once, in handlers it already subscribes per session.
- The toolset keeps only the submit observer. It hands the observer's reading to the handle as relative destinations.
- The toolset holds no frame, session, loader, or request state.

### (1) The page contract

The following signatures go into `src/core/types.ts`, in the navigation section after `BrowserNavigationManagerInterface`.

```ts
export interface BrowserNavigationManagerInterface {
	wait(pattern: string, options?: BrowserCallOptions): Promise<string>
	idle(options?: BrowserCallOptions): Promise<void>
	/** Opens a record of the navigations the page's frames start from this call on, for an input dispatched into `frame` next. Thrown when the page is closed: the page's closed error. */
	record(frame: string): BrowserNavigationRecordInterface
}

/** Settles the navigation an input into one frame started, from the steps the page accepted after the record opened. */
export interface BrowserNavigationRecordInterface {
	/** Resolves when the record's frame or one of its ancestors starts a navigation after the record opened; rejects at `timeout` with `BROWSER_NAVIGATION_TIMEOUT`, with `signal.reason` on abort, and when the record ends or the page closes. */
	wait(options?: BrowserCallOptions): Promise<void>
	/** Follows the earliest navigation started after the record opened in the record's frame, one of its ancestors, or a frame `destinations` names, waiting within `timeout` for a destination to start one; resolves with the stage reached at completion or at `timeout`, or `undefined` when none started. Rejects with `signal.reason` on abort, and when the record ends or the page closes. */
	settle(options?: BrowserSettlementOptions): Promise<BrowserSettlementResult | undefined>
	/** Ends the record and rejects a pending `wait` or `settle`. */
	destroy(): void
}

/** Names the frame a submission targets relative to the frame whose document submitted, mirroring the HTML `_self`, `_parent`, and `_top` keywords. */
export type BrowserDestinationRelationship = 'self' | 'parent' | 'top'
export interface BrowserDestination {
	readonly frame: string
	readonly relationship: BrowserDestinationRelationship
}
export interface BrowserSettlementOptions extends BrowserCallOptions {
	readonly destinations?: readonly BrowserDestination[]
}
export type BrowserNavigationStage = 'requested' | 'committed' | 'loaded'
export interface BrowserSettlementResult {
	readonly url: string
	readonly stage: BrowserNavigationStage
}

/** Maps the navigation steps a page accepts from the session that owns each frame, which it hands to its navigation and element managers. */
export type BrowserNavigationEventMap = {
	readonly request: readonly [frame: string, url: string, loader: string | undefined]
	readonly commit: readonly [frame: string, url: string, loader: string | undefined, same: boolean]
	readonly load: readonly [frame: string, loader: string | undefined]
	readonly detach: readonly [frame: string]
}
```

The contract has these parts:

- **Member.** `record` sits on `BrowserNavigationManagerInterface`. The guide already describes that manager as the place that "waits for a navigation the page performs on its own" (`guides/browser.md:1787`). The page class itself gains no member.
- **Parameters.**
  - `frame` is the frame that receives the input: `element.frame` for `click` and `type`, and `page.id` for `press`.
  - `destinations` pairs each document that read a surviving submission with that submission's relationship. The page resolves `parent` and `top`; the toolset maps nothing.
- **Return value.** `settle` returns `undefined` when no navigation started. Otherwise it returns `{ url, stage }`:
  - `requested` carries the requested URL.
  - `committed` and `loaded` carry the committed URL.
  - A same-document commit of the selected frame completes the settlement as `loaded`.
- **Errors.**
  - `record` throws the page's closed error.
  - `wait` rejects at its timeout with `BROWSER_NAVIGATION_TIMEOUT`, as the manager's `wait` does.
  - `wait` and `settle` reject with `signal.reason` on abort, and with the manager's page-closed error on `close`.
  - `settle` never rejects on its timeout, because the stage it reached is the answer.
- **Selection rule.** These frames are eligible: the record's frame and every ancestor (the main frame always), plus every frame `destinations` resolves to.
  - The earliest eligible start after the record opened is selected.
  - A later start in the selected frame before its commit supersedes it. This covers a script redirect; a server redirect keeps one loader.
  - The commit must carry the selected loader when both are known. Otherwise the selected frame's first commit after the start is taken.
  - The load must carry the commit's loader.
  - A destination whose parent the page cannot name waits for the first start in any frame. It never maps to the main frame.
- **Events the page consumes.** Every subscription is persistent: made in the constructor for the page session and in `#watchSession` for each frame session. None is made or released per action.
  - `Page.frameStartedNavigating` produces `request` with the loader. The fallback is `Page.frameRequestedNavigation` with `disposition` `currentTab`, which produces `request` without a loader.
  - `Page.frameNavigated` produces `commit`.
  - `Page.navigatedWithinDocument` produces `commit` with `same` set.
  - `Page.lifecycleEvent` with name `load` produces `load`. The page enables `Page.setLifecycleEventsEnabled` in `#enableFrameSession`, so a frame session reports it too.
  - `Page.frameStoppedLoading` produces `load` only for a commit that carried no loader.
  - `Page.frameDetached` produces `detach`, except when `reason` is `swap`.
  - `Page.frameAttached`, on every session, gives the parent record.
  - `Target.attachedToTarget` and `Target.detachedFromTarget` carry session moves and supersession.
  - At publication the page reads the frame tree (for the loader) and `document.readyState`. That read runs after lifecycle events are enabled, so publication emits `commit`, and `load` when the document is complete, with no gap.
- **Ownership rule (one home).** The page accepts a step about frame F only from the session that owns F when the step arrives:
  - the page session for an in-process frame and for a swap;
  - otherwise the `#frameSessions` owner.

  A superseded session's step is dropped. This is the rule the element manager applies at `src/core/elements/BrowserElementManager.ts:502-533` and the page applies at `src/core/BrowserPage.ts:1497-1506`. It moves into one page handler.

  The page emits accepted steps on a private `Emitter<BrowserNavigationEventMap>` and passes it by constructor to `BrowserNavigationManager` and `BrowserElementManager`. The element manager drops its own session map, which is how its ownership tracking is reused rather than duplicated.
- **Document generations.**
  - A publication is a commit.
  - A `commit` that is not `same` replaces F's document. The world cache is already dropped at `src/core/BrowserPage.ts:1465-1473`, and the element manager drops F's references.
  - A record sees only steps emitted after its construction. That is the generation boundary between actions.
- **Class placement.** `BrowserNavigationRecord` is an added implementation file, `src/core/BrowserNavigationRecord.ts`. It is not exported from the barrel; `tests/guides.test.ts` lists it as internal. `BrowserNavigationManager` constructs it from the page's emitter, the page's main-frame id, and a synchronous parent lookup the page supplies.

### (2) How the toolset uses the contract

The following sketch shows `#click`; `#type` and `#press` differ only where noted.

```ts
const observation = await this.#observe(page, [element.frame], signal) // refuses BROWSER_TOOLSET_OBSERVE before any input
const record = page.navigation.record(element.frame) // sync, after installation, before the input
try {
	return [await this.#settle(element.click({ signal }), action, signal, trusted, observation, record), '']
} finally {
	record.destroy()
	this.#unobserve(observation) // token-scoped removal, sent always, awaited only within the receipt deadline
	turn.resolve()
}
```

The steps run in this order:

1. **Observe.**
   - `#observe` takes the ids of the documents that can receive the input: `element.frame` for `click` and `type`, and every frame one `page.frames()` call lists for `press`.
   - It installs `compileSubmitObserverExpression(token)` in each, concurrently. `token` is the action's sequence number.
   - The action owns a document from the moment its installation is sent, not from when it succeeds.
   - The input's document must install. Otherwise the action refuses with `BROWSER_TOOLSET_OBSERVE` and the receipt row the verdict kept.
   - For `type` with `submit`, observation and the record both precede `fill` or `select`.
2. **Dispatch.** `#settle` races the command against `record.wait({ signal: receipt })`. That keeps today's behaviour: the command stays pending, held as the queue barrier, when a navigation starts first.
3. **Read.** After the race, the deadline starts where `src/core/constants.ts:402-417` says it does. `#readSubmissions` evaluates `compileSubmitReadExpression(token)` in each owned document, bounded by `deadline - BROWSER_TOOL_CAPTURE_MS`. Each relationship becomes `{ frame: document, relationship }`. A failed read contributes nothing, because the record already holds any navigation in the input chain.
4. **Choose the destination frame.** The toolset chooses nothing. It passes `destinations`, and the page resolves and selects.
5. **Settle.** The toolset calls `record.settle({ destinations, timeout, signal })` inside `#race`, so a dialog returns the dialog receipt as today. It maps the result to a receipt status:
   - `undefined` or `loaded`: no status.
   - `committed`: `the page is still loading URL`.
   - `requested`: `it requested URL and the page did not change`.
6. **Capture.** `#capture` runs unchanged within the same deadline.
7. **Cleanup.**
   - `record.destroy()` is synchronous.
   - `#unobserve` sends the token-scoped read for every owned document not yet read, without the action's signal. It awaits the removals only within the receipt's remaining deadline, and not while a dialog is open.
   - A late removal whose token differs is a no-op in the in-page expression, so it cannot remove the next action's observer.
   - A replaced document takes its observer with it, so it needs no removal.
8. **DOM placement.** A view without a page gets neither a record nor an observer. `src/browser` keeps its own settle.

### (3) Each review ordering under the contract

Every row in the following table is a test named by behaviour, in the file the last column gives.

| Ordering (review, claim) | Outcome | Test (file) |
| --- | --- | --- |
| R1 claim 2: the edit's `Input.insertText` runs a handler that submits | The observer and the record precede `fill` and `select` | installs the submit observer and opens the navigation record before the edit's first input command (BrowserToolset) |
| R1 O1 and D3: a child submits; input and capture finish before its request (both session arrangements) | The observer sits in `element.frame`; the read gives `self`; settle waits for the child's start, commit, and load | waits for an in-process child frame's navigation that its submission starts after the input settles; waits for an out-of-process child frame's … (BrowserToolset) |
| R1 O2: a prevented submit, then a navigating one, and the reverse | The read reports any surviving submission | the existing compiler cases (compilers) |
| R1 O3 and claim 4: the read fails after the input frame's request; commit and load are held | The start is in the record; settle follows it | keeps the receipt pending until commit and load when the observer read fails after the input frame's navigation started (BrowserToolset) |
| R1 D2: the request arrives before the input reply, or between the reply and the read | The record holds both; `wait` wins the race in the first; settle takes it in the second | settles a submission whose navigation starts before the input command replies; … between the input reply and the observer read (BrowserToolset) |
| R1 claim 3: every listener prevents the submission | settle resolves `undefined` at once | returns the same-page receipt without a navigation wait when every listener prevented the submission (BrowserToolset) |
| R2 11: installation fails | The input document is required; for `press`, another document's failure is tolerated | refuses the action before any input when the input's document cannot be observed; presses the key when a child document's installation fails (BrowserToolset) |
| R2 11 and R3 11: a frame attaches after the census, before dispatch | `click` and `type`: it is not the input's document, so it needs no observer. `press`: limit, see T1 | installs in no frame attached after the census for a click in the main frame (BrowserToolset) |
| R2 12: request on S1, then commit and stop on replacement S2 | The page's per-session subscriptions from attach time report S2; the loader ties the steps | settles a child navigation whose commit and load arrive on the frame's replacement session (BrowserNavigationRecord, BrowserToolset) |
| R2 12, recovery: commit and load before S2 enables | Publication emits `commit` and `load` from the tree and `readyState` | reports a commit and load for an out-of-process frame whose document committed and loaded before its session enabled (BrowserPage) |
| R2 claim 1: action A's late commit and load before action B's input | B's record opens after them | does not settle an action on its predecessor's commit and load that arrive before its input (BrowserToolset) |
| R2 O1, R3 21, R3 O2: release from the wrong session; duplicate bookkeeping | No per-action CDP subscription exists; the `BrowserFrame` session records are deleted | leaves the client's registrations as it found them after an action whose frame moved sessions (BrowserToolset, recording transport) |
| R2 O2: a child submits to `_top` or `_parent` | The page resolves the destination | waits for the main frame's navigation when a child submits a form targeting `_top`; waits for the parent frame's navigation … `_parent` (BrowserNavigationRecord, BrowserToolset) |
| R2 O4, R3 23: refusal or abort before the read; partial installation; dialog during installation | Ownership starts at send; removal is sent on every exit | removes the observer when the click refuses before the read; removes the observer from a document whose installation completed when another installation is aborted; … when a dialog opens during installation (BrowserToolset) |
| R3 17: an observed frame is republished on another session before dispatch | The observer dies with its document; the element's reference is `GONE`; `press` is under T1 | refuses a click whose frame's document was replaced after the observer installed (BrowserToolset) |
| R3 19: `_parent` from a nested out-of-process child with lost parent metadata | The parent comes from `Page.frameAttached` on the parent's session; an unknown parent waits on any first start | waits for the out-of-process parent's navigation when a nested out-of-process child targets `_parent`; waits for the first navigation any frame starts when the page cannot name the parent (BrowserNavigationRecord, BrowserPage) |
| R3 20: S1 commit and stop after S2 publication | The superseded session's steps are dropped; the loader mismatches | ignores a commit and stop from the frame's superseded session (BrowserPage, BrowserNavigationRecord) |
| R3 22: A's delayed request during B's installation; a predecessor commit after the selected start | The record opens after installation; a mismatched loader is rejected | does not select a predecessor's request that arrives while the next action installs its observer; rejects a commit whose loader differs from the selected navigation's (BrowserToolset, BrowserNavigationRecord) |
| R3 O1: a withheld frame-tree read or subscription, then abort or dialog | Settle reads no tree; `destroy` is synchronous; removal is never awaited past the deadline | returns the dialog receipt while the observer read is withheld; returns the receipt at its deadline while an observer removal is withheld (BrowserToolset) |
| R3 O5: selected request, then `navigatedWithinDocument` | A `same` commit completes as `loaded` | settles a submission whose navigation stays within the document (BrowserNavigationRecord, BrowserToolset) |
| R3, redirect (held) | A later start in the frame supersedes; a 303 keeps one loader | follows a navigation that supersedes the selected one in its frame before commit (BrowserNavigationRecord); the POST-and-303 service case (service/toolset) |
| Verdict: a dialog opens during the wait | The dialog receipt | the existing dialog cases (BrowserToolset, service/toolset) |

### (4) What is deleted from the toolset

In `src/core/BrowserToolset.ts`, these go:

- The fields `#sequence`, which survives only as the observer token, `#requests`, `#commits`, `#loads`, `#main`, `#changed`, `#observed`, `#followed`, `#landing`, and `#published`.
- The reset at lines 799-803.
- The methods `#readSubmission` (replaced by the smaller `#readSubmissions`), `#readDestinations`, `#mapDestination`, `#findRequest`, `#findCommit`, `#findLoad`, `#awaitRecord`, `#follow`, `#watchFrame`, `#subscribe`, `#track`, `#releaseAction` (replaced by `#unobserve`), `#handleSession`, `#readReadiness`, `#findLoader`, and `#notify`.
- The handlers `#handleRequested`, `#handleNavigated`, `#handleLifecycle`, and `#handleStopped` (lines 1547-1589), with their subscriptions in `#watch` and `#release`.

Outside the toolset:

- The `BrowserToolsetWatch` type loses `requested`, `navigated`, and `lifecycle` (`src/core/types.ts:2126-2134`).
- `BrowserFrame` loses its `#subscriptions` session records (`src/core/BrowserFrame.ts:188-203`). The `unsubscribe` contract text returns to its original wording at `src/core/types.ts:2222-2226`.
- The element manager loses `#sessions`, `#own`, `#owns`, `#watch`, `#unwatch`, `#frameChanged`, `#detached`, and its `session` listener, because it reads the page's navigation events instead.

These stay: `#observe`, `#install`, `#resolveFrame`, `BrowserPageElementInterface.frame`, and the `BROWSER_TOOLSET_OBSERVE` refusal.

## Alternatives

- **A one-shot `page.navigation.settle(dispatch, options)`, where the page runs the input.** Rejected. The toolset would lose the pending command it holds as the queue barrier, and the per-step dialog labels. The page would also take a callback into toolset behaviour, so ownership would cross the other way.
- **Public frame-level events on `page.emitter` (`request`, `commit`, `load`), with the toolset correlating them.** Rejected. The toolset would track loaders and selection again, which is exactly what the withdrawn design leaked on.

## Constraints

- Single-word members, and split rather than compound: `/home/user/scaffold/AGENTS.md:50`, `/home/user/scaffold/.claude/rules/names.md:27-31`, and `:36-81`.
- One concept, one term; real domain states; absence is `undefined`; named discriminants: `/home/user/scaffold/AGENTS.md:52-57` and `names.md:118-120`.
- Type-name forms (`Options`, `Result`, `{Entity}{Noun}`): `names.md:153-164`. Lifecycle `destroy`: `names.md:218-232`.
- Minimal public API; no shims; no polling: `/home/user/scaffold/AGENTS.md:63-66`.
- Event names: `/home/user/scaffold/.claude/rules/patterns.md:104-108`. TSDoc voice: `/home/user/scaffold/.claude/rules/typescript.md:78-88`.
- The manager's stated job: `/home/user/browser/tmp/worktrees/c6/guides/browser.md:1787`. The receipts: `:2279-2280`. The deadline start: `/home/user/browser/tmp/worktrees/c6/src/core/constants.ts:402-417`.
- The page's per-session subscriptions: `/home/user/browser/tmp/worktrees/c6/src/core/BrowserPage.ts:1178-1185` and `:316-325`. Attach and publication: `:1657-1734`. Frame-tree recovery: `:1213-1221`. Parent at attach: `:1445-1463`, and `:1692-1697` drops it.

## Refusals

- **`page.settleNavigation` or `record.settleSubmission`.** Refused by "Public methods: one word" (`names.md:29`).
- **One `settle(mode)` where a literal chooses between start-wait and follow.** Refused by "A literal that selects a different action is a magic mode and requires separate functions/methods" (`names.md:75`). That is why `wait` and `settle` are two members.
- **A `{ stage: 'none' }` result.** Refused by "Absence is `undefined`. No sentinels." (`AGENTS.md:54`).
- **`BrowserNavigationWatchInterface` beside the public `BrowserNavigationWatch` (`guides/browser.md:687`).** Refused by "One concept, one term." (`AGENTS.md:52`).
- **`cancel()` on the record.** Refused by "Never introduce synonyms such as `cancel`" (`names.md:232`).
- **A public intake method on `BrowserNavigationManager` that the page calls.** Refused by "Each implementing class exposes exactly its interface methods" (`documentation.md` § Parity). The page's events arrive by constructor injection instead.
- **`kind` or `type` as the destination axis.** Refused by "Name the axis ... never `kind` or `type`" (`AGENTS.md:57`).

## Measurements

The only reading supplied is the withdrawn tree's gate set: `test:src` 1128 and `test:service` 49 passed with 1 skipped, from `/home/user/browser/.orkestrel/browser/c6-review-verdict.md:26`. Every reading from P1 to P7 is missing; see Risks.

## Units

The units run in order, on one worktree, with one writer at a time. The Orchestrator can merge U1 to U3 into the single implementation unit the verdict names.

- **U0, probe: `astra` on GPT-6 Astra.**
  - Owns `tmp/probes/c6-navigation.test.ts` only.
  - Drives the service fixtures `/shop`, `/frame/voucher`, and an A→B→A nested cross-site frame on the host Chromium.
  - Records method, session, frameId, loaderId, and timestamp for P1 to P7, with a control for each.
  - Accepted when every reading carries its raw trace. No source edits.
- **U1, page contract: `astra`.**
  - Owns the navigation section of `src/core/types.ts` plus `BrowserNavigationEventMap`, and `src/core/BrowserPage.ts`, `src/core/BrowserNavigationManager.ts`, and `src/core/BrowserNavigationRecord.ts` (added).
  - Owns the tests `tests/src/core/BrowserPage.test.ts`, `tests/src/core/BrowserNavigationManager.test.ts`, and `tests/src/core/BrowserNavigationRecord.test.ts`, plus fixtures in `tests/setup.ts` with their proofs in `tests/setup.test.ts`.
  - Depends on U0.
  - Accepted when the types typecheck first; the record and page rows in the table are green; a recording transport shows `record` adds no client registration; and `npm run test:src` is green.
- **U2, element manager on the page's events: `astra`.**
  - Owns `src/core/elements/BrowserElementManager.ts`, its input type, and `tests/src/core/elements/BrowserElementManager.test.ts`.
  - Depends on U1.
  - Accepted when the existing reference-drop cases for child navigation, detach, and swap stay green; the manager subscribes to no `Page.frameNavigated` or `Page.frameDetached`; and a superseded session's commit drops nothing.
- **U3, toolset: `astra`.**
  - Owns `src/core/BrowserToolset.ts`, `src/core/compilers.ts` (token parameter), `src/core/BrowserFrame.ts` (the revert), and the `BrowserToolsetWatch` and `unsubscribe` text in `types.ts`.
  - Owns the tests `tests/src/core/BrowserToolset.test.ts`, `compilers.test.ts`, and `BrowserFrame.test.ts`, plus `tests/setup.ts` and `tests/setup.test.ts` (the review-3 O4 proofs), and `tests/service/toolset.test.ts`.
  - Depends on U1 and U2.
  - Accepted when the toolset rows are green; the members listed in part (4) are absent; `#settle` holds no frame, session, or loader state; removing `destinations` reddens the child and `_top` rows; and `test:src`, `test:setup`, and `test:service` are green.
- **U4, guide G1: `opus` on Opus 5.5.**
  - Owns `/home/user/browser/tmp/worktrees/c6/guides/browser.md` and `tests/guides.test.ts` (the internal list and the fences).
  - Adds the `record` row to the manager table and a `BrowserNavigationRecordInterface` method table (`wait`, `settle`, `destroy`).
  - Adds Surface rows for the new types, updates `BrowserToolsetWatch`, adds `frame` to the `BrowserPageElementInterface` Surface row, and restores the `unsubscribe` summary.
  - Adds a receipt row for the observation refusal and one sentence to invariant 18 naming the record. The toolset TSDoc paragraph at `BrowserToolset.ts:97-102` is rewritten to match.
  - Depends on U3. Accepted when `npm run test:guides` is green.

## Tensions

The following judgment calls are for the objective lane or the Orchestrator to rule.

- **T1: observer scope.** I scope the observer to the documents that can receive the input: the element's document for `click` and `type`, and the census for `press`. A script that submits a form in another frame is outside the contract. For `press`, a document attached or replaced after the census is a documented limit. The objective lane might require every document.
- **T2: a predecessor's navigation that starts after the next action's input.** Without initiator correlation it cannot be told apart from the next action's own. The receipt then shows the page's true state. Correlating by URL and `reason` would close it at the cost of rebuilding GET query strings in the page.
- **T3: element-manager migration.** I read the brief's "reused, not duplicated" as putting U2 in this change.
- **T4: `settle` resolves at its timeout.** It resolves with the stage reached, while `wait` and `idle` reject at theirs. I rule resolve, because the stage is the answer.
- **T5: the `record.wait` name.** It reuses `wait` as "resolves when X appears", consistent with the page and manager members of that name.
- **T6: `BrowserFrame` session records.** I rule revert, because no consumer remains. The alternative is to keep them, fixed with distinct sessions per review 3 O2.
- **T7: shrinking `BrowserToolsetWatch`.** These members predate C6. I treat the type as a listener bag, not the toolset's surface.
- **T8: attach mode.** `waitForDebuggerOnStart: true` would replace publication-time recovery, but every auto-attached target, workers included, would then need an explicit resume.
- **T9: cleanup waits.** Removals are sent on every exit, awaited within the deadline, and not awaited while a dialog is open. The token guards late arrivals.

## Risks

Each risk the sources cannot decide follows, with the probe that settles it.

- **P1.** Does the host Chromium emit `Page.frameStartedNavigating` for a POST-and-303 form in the main frame, an in-process child, and an out-of-process child, with the loader equal to the later `frameNavigated` and `load` loaders? Probe: U0 over `/shop` and `/frame/voucher`. If absent, `frameRequestedNavigation` becomes the start, and the loader-mismatch test for R3 22 degrades to first-commit-after-start.
- **P2.** Which session carries the start of a cross-process child navigation, and does S2's commit precede its `Page.enable`? Probe: U0 over `/frame/voucher` with session ids.
- **P3.** Does `Page.setLifecycleEventsEnabled` on a frame session report `load` for that target's root frame? Probe: U0, with a control that has lifecycle events disabled.
- **P4.** Does a nested out-of-process frame attach through the page session's auto-attach? Does `TargetInfo.parentFrameId`, or the parent session's `Page.frameAttached`, name its parent? Probe: U0 over an A→B→A fixture.
- **P5.** For a form submit, does `frameRequestedNavigation` arrive before or after the input reply (review 1 D2)? The contract's outcome does not depend on the answer; a timestamped trace in U0 confirms it.
- **P6.** Does the page session also report `frameNavigated` for an out-of-process frame's commit? If it does, the ownership rule could drop the only report. Probe: U0.
- **P7.** Does a same-document submission emit a start before `navigatedWithinDocument`? Probe: U0 with a GET form whose action is a fragment.

