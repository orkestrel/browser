# C6 settlement design, objective lane (Astra `analyst`, read-only, 423 346 ms, verbatim)

Add a prearmed `BrowserPage.settle(...)` operation. The page owns navigation evidence and document lifetimes; the toolset supplies submission observation, dispatches input through the operation, and renders the returned facts.

Moving the existing event arrays into the page is insufficient. The contract must distinguish document replacement, session replacement, navigation identity, and action attribution. It must also acknowledge two limits: CDP does not identify the input action responsible for every navigation, and a dialog can prevent observer removal from executing before the receipt returns.

This design is based on checkpoint `5179859560115b455a7e752cf86186a3237a08c6`. No files were changed or tests run.

**The page contract**

Expose the operation on `BrowserPageInterface`, where session attachment, document worlds, explicit navigation, and frame ownership already meet. Keep `navigation.wait()` and `navigation.idle()` as their existing capabilities; make them consume the same underlying page state where applicable.

The public signature is:

```ts
settle(
	action: BrowserPageActionFunction,
	options: BrowserPageSettlementOptions,
): Promise<BrowserPageSettlementResult>

type BrowserPageActionFunction =
	(options: BrowserCallOptions) => Promise<void>
```

The action must be a callback. Accepting an already-started promise cannot establish observation before input.

Define the following contracts in `src/core/types.ts`, before implementation:

| Contract | Contents and meaning |
|---|---|
| `BrowserPageSettlementOptions` | Readonly `frame`, `observer`, `timeout`, `reserve`, and `signal`. `frame` identifies the input document for an element action. Keyboard input requires the page to resolve the focused document. |
| `BrowserPageObservation` | Toolset-supplied installation, read, and removal expression compilers, each accepting a page-issued observation identifier; a decoder converts a read into submission destinations. The page executes these expressions and owns their lifetimes. |
| `BrowserNavigationDestination` | A document-scoped submission intent naming `self`, `parent`, or `top`. The page supplies the originating document identity; the toolset never supplies session or loader identifiers. |
| `BrowserPageSettlementResult` | Either an open `dialog`, or the absolute capture `deadline` with optional `navigation`. |
| `BrowserNavigationSettlement` | Readonly destination `frame`, effective `url`, and `phase`: `requested`, `committed`, or `complete`. A completed result also identifies whether it was a same-document navigation. |

An absent navigation means that no eligible navigation was established. It does **not** mean that the document was proven unchanged.

The observer contract is justified by its lifecycle: it makes execution document-bound, covers document arrivals, and owns partial installation and cleanup. It is not a general script plugin system. The submit predicate remains in the toolset’s compiler functions.

The operation has these outcomes:

- No qualifying submission and no eligible arrived navigation: return without a speculative navigation wait.
- Positive submission evidence: await its destination’s navigation until the settlement bound.
- Request without commit at the bound: return `requested`.
- Commit without completion at the bound: return `committed`.
- Matching load, same-document completion, or applicable back-forward cache restoration: return `complete`.
- Dialog: return the existing `BrowserDialogInterface` immediately.
- Abort: reject with the exact `signal.reason`, including cancellation concurrent with a successful protocol reply.
- Dispatch failure: preserve the original error.
- Required observation unavailable before dispatch: reject with a page observation error; the toolset translates it to `BROWSER_TOOLSET_OBSERVE`.
- Detached destination, failed navigation, lost transport, or unresolved attribution: reject with distinct coded `BrowserError` values. Errors after dispatch must say the action was sent; they must not claim a pre-input refusal.

Use `BROWSER_NAVIGATION_UNCERTAIN` for evidence that cannot identify the selected navigation. Do not represent that condition as “the page did not change,” successful completion, or `BROWSER_TOOL_CHANGED_NOTE`.

The ownership rules are:

| Fact | Owner and rule |
|---|---|
| Frame identity and parent relationship | One page-owned frame record, maintained from attachment, detachment, and frame-tree evidence. Unknown parentage remains unknown. Only a positively identified root treats `_parent` as itself. |
| Session routing | The same record owns the active route and its generation. Replacement revokes the previous route before asynchronous initialization begins. |
| Document identity | A page-owned document generation tied to the committed document and execution context. Same-document navigation preserves it. An execution-context loss invalidates evaluations even when the document survives. |
| Navigation identity | A page-owned attempt associates request evidence, loader identity, redirects, commit, and completion. Its lifetime extends beyond a receipt that times out. |
| Element references | The element manager retains reference allocation, `SESSION:BACKEND` bindings, and invalidation. Its ownership and generation machinery must be shared with the page record, not copied into a competing tracker. |
| Reading staleness | Preserve the existing navigation epoch semantics. A reading epoch is not an observer’s document generation: same-document navigation can stale a reading without destroying its observer. |
| Submission observation | The toolset owns the predicate and destination vocabulary. The page owns each installed instance, its exact document/context, pending installation, and removal. |
| Action attribution | The page associates evidence with the action scope where the evidence permits that association. Arrival after dispatch alone is insufficient. |

Refactor the element manager’s existing ownership revocation into the shared page-owned mechanism. Preserve its `#changes` capture check and `GONE` behavior as consumers of that mechanism. Do not leave the page and element manager independently deciding which session owns a frame.

Subscribe before enabling a session. Consume:

- `Target.attachedToTarget` and `Target.detachedFromTarget`;
- `Page.frameAttached`, `Page.frameDetached`, and `Page.frameNavigated`;
- `Page.frameRequestedNavigation` and, where supported, `Page.frameStartedNavigating`;
- `Page.navigatedWithinDocument`, `Page.lifecycleEvent`, and `Page.frameStoppedLoading`;
- execution-context creation, destruction, and clearing;
- document network requests, redirect relationships, and failures;
- dialog opening, page closure, and crash.

`frameRequestedNavigation` identifies a destination frame and requested URL, but carries neither an action identifier nor a loader identifier. `frameStartedNavigating` supplies a loader; document network requests also carry loader and request identifiers. These support navigation correlation, not universal causal attribution to input. See the official [Page protocol](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl) and [Network protocol](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Network.pdl).

Apply these evidence rules:

- Events from a superseded route cannot mutate the current document or satisfy its completion.
- Parent-session structural events can describe a frame’s move. They cannot automatically certify the replacement document’s readiness.
- A frame-tree recovery must recover loader and parent evidence as well as URL and name. Publication itself is not a commit.
- A loaderless stop event is a wakeup for a document-bound readiness check, not proof that the latest recorded loader loaded.
- Readiness evaluation must target the pinned execution context. Validate ownership before sending and after receiving the reply.
- Redirects update an identified navigation chain. A different URL is permitted; an arbitrary later loader is not automatically a redirect.
- Same-document completion updates the selected destination immediately without waiting for a replacement document or load event.

Keep predecessor attempts across action boundaries. A request arriving during preparation cannot belong to input that has not been dispatched. A known predecessor’s loader remains excluded even if its commit follows the current request. When predecessor and current intents remain indistinguishable, return the uncertainty error rather than guessing.

**The toolset’s `#settle` sequence**

The toolset becomes a coordinator of observation semantics, action text, input, and capture:

1. **Observe.** Pass the submit observation program into `page.settle`. The page acquires cleanup ownership before sending each installation command. It confirms installation in the required document generations before invoking input.
2. **Dispatch.** Invoke the callback once. For `type` with `submit`, the callback includes both `fill` or `select` and submission, so observation precedes the first edit. Record the underlying command through the existing pending-command mechanism.
3. **Read.** After input completes, read surviving source documents through their pinned contexts. A destroyed source document needs no removal. An already-recorded navigation remains usable when its source read fails.
4. **Choose the destination.** The toolset decoder supplies qualifying `self`, `parent`, and `top` intents. The page resolves them through its authoritative tree and selects the earliest eligible navigation evidence. A destination needs no submit observer of its own to become eligible.
5. **Settle.** The page follows the selected attempt across route changes and redirects, under one settlement bound.
6. **Capture.** The toolset maps `requested` and `committed` to the existing receipt wording, then calls its existing bounded capture with the returned absolute deadline. Preserve the capture retry and changed/deadline notes.

A main-frame request must pass the same attribution rules as a child request. It cannot bypass destination selection merely because it won a promise race.

Observation must cover documents that can receive a submission during input preparation and dispatch. For the supported cross-frame scripted submission behavior, a completed `frames()` census is insufficient. Register the observation program for document creation, install it in existing documents, and retain attachment reconciliation through dispatch. Registering a script for document creation is the protocol mechanism intended to precede frame scripts; its coverage across the deployed Chromium’s process swaps still requires the probe described later. See [Page.addScriptToEvaluateOnNewDocument](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl).

If coverage cannot be established before input, refuse. If a coverage gap is discovered after input, report uncertainty. Never turn an unobserved document into a negative submission result.

The observer retains every submission through its observation interval. Prevented submissions, `method="dialog"`, and excluded browsing contexts add no destination. Submitter overrides and the document’s base target retain their existing semantics. Reads and removal address the observation identifier, so delayed cleanup from action A cannot remove action B’s observer.

Deadline handling must preserve the recorded ruling:

- Queue time precedes the receipt bound.
- Preparation and dispatch use bounded call options and remain abortable and dialog-interruptible.
- Establish the receipt deadline when the input completes or an eligible navigation starts the receipt’s navigation wait, matching the existing boundary.
- Set the navigation bound to `deadline - BROWSER_TOOL_CAPTURE_MS`.
- Reads, session recovery, readiness checks, and awaited cleanup consume the remaining budget; none receives a fresh timeout.
- Capture uses the original deadline.
- Preparation that fails before this boundary uses its preparation bound for cleanup. This does not silently redefine the receipt deadline as an action-start deadline.

Every asynchronous stage needs both cancellation propagation and a generation check after it resumes. Racing a promise alone does not prevent its continuation from installing an observer or publishing stale readiness.

Cleanup has separate local and remote obligations. At every exit, synchronously close the action scope, revoke its local consumers, and cancel its pending waits. Await remote removal only within the remaining bound. The page retains exact ownership of late installation replies and blocked removals; it removes them when execution becomes available or discards them when their document dies. A closed scope can never contribute evidence to another action.

The pending input command remains the toolset’s queue barrier. Matching mouse/key releases retain their existing signal-independent behavior. A dialog receipt must not wait for either blocked evaluation or the pending release.

**The ordering matrix**

The following tests exercise the real page, toolset, and element manager against protocol-faithful fixtures. Each pending assertion holds the next stage separately; releasing commit and load together does not prove both waits.

| Ordering | Contract outcome | Behavior-named test |
|---|---|---|
| Input reply → positive read → request → commit → load | Remain pending through request and commit; complete on load. | `waits for a submitted navigation requested after input completes` |
| Installation → text insertion triggers `requestSubmit()` → Enter | Observation includes the edit-triggered submission. | `observes submission before inserting text` |
| Installation → select change triggers submission | Observation includes the selection-triggered submission. | `observes submission before selecting an option` |
| Negative read, no arrived request | Capture without speculative navigation delay. | `returns promptly when submission does not navigate` |
| Request arrives during read → read fails → held commit → held load | Preserve request; await both later stages. | `follows an arrived navigation when its observer read fails` |
| Source destruction → read failure → delayed request | Follow identifiable retained evidence; otherwise report uncertainty. | `does not treat a destroyed observer as a negative submission` |
| Prevented submit → navigating submit | Follow the qualifying submission. | `retains a navigating submission after a prevented submission` |
| Navigating submit → prevented submit | Preserve the earlier qualifying intent. | `does not erase navigation with a later prevented submission` |
| Several prevented submissions → later qualifying submission | Retain the later qualifying intent. | `retains submissions throughout the observation interval` |
| Reinstallation → delayed earlier cleanup | Earlier cleanup affects only its own identifier. | `keeps a replacement observer when earlier cleanup finishes` |
| Child submission with input-before-request, in either session arrangement | Follow the child destination and capture its rendered result. | `settles submission in an in-process child`; `settles submission in an out-of-process child` |
| Frame attaches while another installation is pending | Include it before dispatch. | `observes documents attached during installation` |
| Frame attaches after census while focus/actionability is pending | Document-creation coverage observes it before submission. | `observes a frame attached during input preparation` |
| Observed frame moves S1 → S2 while installation continues | Validate the document/context generation and install where required. | `reconciles an observed frame that changes session before dispatch` |
| Required installation fails | Send no input; return observation refusal. | `refuses input whose submission coverage cannot be established` |
| F installs successfully; G remains pending; abort or dialog occurs | F is already owned; release it and account for G’s late completion. | `releases partial observation after abort`; `releases partial observation after a dialog` |
| Observer installed → actionability refusal or command failure | Release every surviving installation. | `removes observation when input fails` |
| Request wins → observer read skipped → navigation cancelled | Release observation on the terminal path. | `removes unread observation after navigation cancellation` |
| Child submits `_top` before the main request arrives | Await the main destination. | `settles a child submission targeting the top frame` |
| Nested out-of-process N submits `_parent` to P | Await P; never substitute the main frame for unknown parentage. | `preserves the parent of a nested out-of-process frame` |
| Destination lacks its own successful observer read | Originating submission still makes it eligible. | `follows a destination named by another document` |
| Several positive destinations; only one requests | Select the requesting candidate without waiting for every candidate. | `settles the first eligible destination request` |
| Noncandidate child requests while a candidate is pending | Ignore the unrelated request. | `ignores navigation outside the submission destinations` |
| Request on S1 → replacement S2 → commit/load on S2 | Preserve the attempt through the route transfer. | `settles navigation after its frame acquires another session` |
| Out-of-process request → commit/load on page session | Follow the reverse move. | `settles navigation after a frame returns to the page session` |
| Commit/load precede replacement-session publication | Recover loader/document evidence and verified readiness. | `recovers navigation completed before session publication` |
| Publish S2 → stale S1 commit/stop → held S2 readiness | Stale events cannot complete settlement. | `rejects completion from a superseded session` |
| Readiness starts for document A → document B replaces it → A replies complete | Discard A’s reply. | `rejects readiness from a replaced document` |
| A times out; A commits/loads before B’s request | A cannot satisfy B. | `keeps predecessor completion separate from the next action` |
| A’s delayed request arrives during B’s installation | It predates B’s dispatch and remains outside B. | `excludes predecessor requests received before dispatch` |
| A’s commit arrives after B’s selected request | Loader/attempt ownership excludes A. | `rejects a predecessor commit that arrives after the selected request` |
| A and B produce indistinguishable delayed requests from the same document | Report uncertainty; never claim B completed. | `refuses ambiguous attribution between consecutive actions` |
| Request → redirect request → final commit/load | Follow the established chain to its final document. | `settles a redirected submission at its final destination` |
| Request → `navigatedWithinDocument`, no replacement loader/load | Complete as same-document navigation. | `settles same-document navigation without a load event` |
| Stop occurs before the selected commit | It cannot complete that navigation. | `ignores a stop preceding the selected document` |
| Positive observation produces no request | Stop waiting at the bound; do not claim “still loading.” | `bounds a submission that produces no navigation request` |
| Requested navigation never commits | Return requested status and bounded capture. | `captures a receipt when navigation never commits` |
| Commit occurs but load never arrives | Return still-loading status and bounded capture. | `captures a receipt while the destination remains loading` |
| Frame-tree recovery, session enable, world creation, or cleanup remains pending → abort/dialog/deadline | Interrupt promptly; retain ownership of late resource acquisition. | `interrupts every settlement dependency within its bound` |
| Same-turn abort with load or completion-read reply | Cancellation wins; preserve its reason. | `honors cancellation concurrent with navigation completion` |
| Navigation completes or aborts | Clear its wait resources; an intentionally pending dialog command remains owned. | `releases navigation waits on completion and abort` |
| Subscribe on S1/S2 → move to S3 → unsubscribe | Release actual registrations; never resolve S3 for removal. | `unsubscribes from the sessions that received registration` |
| Repeated identical subscription on S1 | Retain distinct registrations only. | `keeps repeated subscriptions idempotent` |
| `_blank`, named target, or dialog-method submission | Preserve existing exclusion and popup/dialog handling. | `excludes submissions outside the current page destination set` |
| Document changes during capture, then changes during its retry | Return the existing changed note. | `bounds capture recovery when documents keep changing` |

Retain the live POST/303 cart assertion, prevented-form assertion, voucher process-swap assertion, and dialog cases. Add live coverage for the opposite swap direction, nested `_parent`, same-document completion, and creation during input preparation.

Retain the reviewed cancellation matrices for `navigate`, `reload`, and history navigation, with client/page cleanup in `finally`. Keep the unrelated S2–S9 regressions. Prove the reusable setup exports identified by review O4 in their setup suite; a production test that uses a helper does not prove the helper’s contract.

**What leaves the toolset**

Delete navigation ownership from `BrowserToolset`:

- `#requests`, `#commits`, `#loads`, `#sequence`, `#main`, and the navigation-specific `#changed` deferred;
- `#follow`, `#watchFrame`, `#subscribe`, `#track`, `#handleSession`, `#readReadiness`, and `#findLoader`;
- `#findRequest`, `#findCommit`, `#findLoad`, and navigation-specific `#awaitRecord`/`#notify`;
- raw request, commit, lifecycle, and stop handlers and their subscription rows;
- frame census, session reconciliation, and `#mapDestination`;
- `#observed`, `#followed`, `#landing`, `#published`, and `#releaseAction`’s document/session cleanup.

Replace `#observe`, `#install`, and frame-oriented submission reads with the observation program supplied to `page.settle`. Retain the submit compilers, adding observation identifiers and guarded removal.

Keep the action queue, pending-command barrier, dialog staging, popup/tab selection, receipt formatting, and bounded capture. Keep `BrowserPageElementInterface.frame` as the element manager’s published frame identity. Repair distinct-session bookkeeping in `BrowserFrame.unsubscribe`; removing the toolset’s consumer does not justify weakening that public contract.

The guide unit must document the page operation, its outcomes and uncertainty error, the observation refusal, `frame` as a property, and the expanded unsubscribe guarantee. `src/browser` retains its DOM settlement and acquires no CDP dependency.

**Risks and the probes that decide them**

| Unsettled question | Probe and decision |
|---|---|
| Can the deployed Chromium distinguish a predecessor’s delayed request from a later action’s otherwise identical request? | Record input dispatch/replies, renderer submission identifiers, request/start/network/commit events, and loader identities for consecutive same-document submissions to identical URLs. If no observable distinction exists, retain `BROWSER_NAVIGATION_UNCERTAIN`. A local action counter cannot supply missing protocol evidence. |
| Does document-creation instrumentation cover initial empty documents, synchronous iframe creation, and both process-swap directions before page script can submit? | Create and submit frames during a held focus operation and inside the input handler. Inspect an installation marker before submission. Test session initialization before resuming paused targets where necessary. A gap requires stronger page attachment ordering or an explicit coverage refusal. |
| What identity and readiness evidence survives a commit before session publication? | Delay domain-enable replies while Chromium completes the frame navigation. Compare frame-tree loader/parent metadata, execution contexts, and document readiness. Admit recovery only from evidence that identifies the same committed document. |
| Which child sessions emit usable lifecycle events on the supported browser? | Capture lifecycle and stop events in both swap directions, with a destination whose subresource deliberately delays load. Prefer matching lifecycle evidence; prove the pinned-context readiness fallback independently. |
| Can submission metadata be read after all relevant listeners without observing later attribute mutations instead of the submitted values? | Use real DOM events with prevention and submitter/form/base changes in capture listeners, bubbling listeners, and microtasks. Compare recorded intent with the actual request and destination. Adjust the compiler from that result. |
| Can physical observer removal finish while a dialog blocks evaluation? | Open a dialog during partial installation, request cleanup, and inspect listener state after dismissal. The receipt must return promptly, and cleanup must finish when execution resumes without touching a later observer. |

The final risk exposes a literal conflict in the brief: bounded, interruptible return and physical DOM removal before every return cannot both be promised while the renderer is blocked by a dialog. The implementable contract is immediate local closure plus page-owned eventual physical removal, or document destruction. If “removed on every exit path” requires completed DOM removal before returning the dialog receipt, the stated constraints have no compliant implementation.