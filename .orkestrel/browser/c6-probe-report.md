# C6 probe U0 report (Opus lane, Chromium 141.0.7390.37 with --site-per-process, verbatim)

## Unit c6-probe (U0): report

All seven readings are answered on Chromium 141.0.7390.37 launched with `--site-per-process`. `npm run test:probe` passed 7 of 7 on two runs, and the answers matched between the runs.

**Touched files**
- `/home/user/browser/tmp/worktrees/c6/tmp/probes/c6-navigation.test.ts` (new, 998 lines, ignored by git) holds P1 to P7, each with its control. It launches Chromium through `createBrowser` and drives every target through a raw `createCDPClient`. That client runs over a recording wrapper around `createCDPTransport`, which timestamps each frame with `performance.now()` as it is sent or arrives. Commands, replies and events are therefore ordered by when they crossed the wire. `client.subscribe` is used per session to follow `Target.attachedToTarget` and track child sessions.
- Diffstat: no tracked changes (`git status --short` is empty). There are no shared-file patches.

**Validation**
- `npm run test:probe` exited 0: 7 passed, about 22 s.
- The `check` script can't cover this file because `tsconfig.json` excludes `tmp`. Instead, `npx tsc --noEmit -p <scratchpad>/tsconfig.probe.json` (extends the project `tsconfig.json`, includes only the probe) gave no diagnostics.
- `prove`: not used. These are runtime protocol questions, so the instrument is a runtime probe. Each reading has a control that behaves differently under the same run.
- Failing-first tests: none. This unit settles readings; it doesn't fix a defect.

**Fixture routes:** none added. Every page is an existing `tests/setupServer.ts` route (`/shop`, `/shop/cart`, `/frame/voucher`, `/beforeunload/plain`, `/beforeunload/next`, `/form`). The fixture server takes no handlers, so child iframes, the A→B→A chain, links and fragment forms are added with `Runtime.evaluate`. If the implementation unit wants a static nesting fixture, it needs one new route: `/frame/nested` on `127.0.0.1`, framing `http://localhost:PORT/frame/middle`, which frames `http://127.0.0.1:PORT/frame/inner`.

In the traces, A = `http://127.0.0.1:PORT`, B = `http://localhost:PORT`, `c1`/`c2` are child frame sessions, `#` is the wire order, and `F`/`L` are shortened frame and loader ids.

### P1: POST form answered with 303
**Answer:** Yes. `Page.frameStartedNavigating` fires in all three placements, on the session that owns the frame (`page` for the main frame and the in-process child, `c1` for the out-of-process child). Its `loaderId` equals the later `Page.frameNavigated` loader and the lifecycle `load` loader. The 303 produces one start, not a second one for the redirect.

Out-of-process child:
```
#360 c1  frameRequestedNavigation F1 url=B/shop/cart reason=formSubmissionPost disposition=currentTab
#361 page < Input.dispatchMouseEvent(mouseReleased)
#363 c1  frameStartedNavigating   F1 L1 differentDocument
#367 c1  frameNavigated           F1 L1
#372 c1  lifecycleEvent load      F1 L1
```
The main frame and the in-process child show the same shape on `page`, with the same loader throughout.

**Control (link click):** same shape and loader equality in all three placements, `reason=anchorClick`.

### P2: cross-process child navigation (voucher swap)
**Answer:** The start (requested and started) is carried by the session that holds the frame's current document. With `waitForDebuggerOnStart: true`, the new session's `Page.frameNavigated` follows its `Page.enable` reply. With `waitForDebuggerOnStart: false`, the new session sends no `frameNavigated` at all.

Forward, B/frame/field → A/frame/done (out-of-process to in-process):
```
#563 c1   frameRequestedNavigation F1 reason=formSubmissionGet
#566 c1   frameStartedNavigating   F1 L1
#569 page Target.detachedFromTarget session=c1
#570 page frameAttached F1
#572 page frameNavigated F1 L1
#574 page lifecycle load F1 L1
```
The commit arrives on `page` with the loader that `c1` announced.

Reverse, A/frame/done → B/frame/field (in-process to out-of-process), wait=true:
```
#595 page frameRequestedNavigation F1 reason=anchorClick
#596 page frameStartedNavigating   F1 L1
#600 page Target.attachedToTarget  c2 (targetId == frame id)
#601 c2 > Page.enable
#602 c2 < Page.enable
#604 c2 lifecycle commit L2        (replay, foreign loader)
#609 c2 > runIfWaitingForDebugger
#611 c2 frameNavigated F1 L1
#613 c2 < runIfWaitingForDebugger
#615 page frameDetached F1 reason=swap
#619 c2 lifecycle load L1
```
Reverse with wait=false: `#745 c2 > Page.enable`, `#747 page frameDetached swap`, `#748 c2 < Page.enable`, then only `loadEventFired`, `frameStoppedLoading` and a replayed commit/DOMContentLoaded/load with L1. `frameNavigated` never arrives on any session.

**Control (B→B link inside the out-of-process frame, no swap):** everything stays on `c1` (requested #848, started #849, `frameNavigated` #854, load #859) and nothing detaches.

### P3: lifecycle on a frame session
**Answer:** Yes. With `Page.setLifecycleEventsEnabled` on the frame session, that session reports `load` for its root frame, with the same loader as `frameNavigated`. This holds for the initial commit (L3) and for a later navigation (`c1=[init DOMContentLoaded load]` on the navigation's loader). Enabling it also replays `commit` and `DOMContentLoaded` under a loader that belongs to no navigation (L4 at #908 and #909), so an implementation must match lifecycle events by loader.

**Control (disabled on `c1`):** `c1` sends no `lifecycleEvent`, only `loadEventFired` and `frameStoppedLoading`, which carry no loader. The page session only ever reports `init` for the child frame (L2, the initial empty document), never `load`.

### P4: nested A→B→A frame
**Answer:** No. The inner A frame is its own `iframe` target, but the page session's auto-attach doesn't reach it. It attaches only through the middle frame's session, and only when that session has its own `Target.setAutoAttach`. The parent is named in two places: `TargetInfo.parentFrameId` (a field in Chromium 141) equals the middle frame's id, and the middle session's `Page.frameAttached` carries the same `parentFrameId`.

Auto-attach off on `c1`:
```
#1122 c1 frameAttached F2 parent=F1
#1125 c1 frameStartedNavigating F2 L5
#1130 c1 frameDetached F2 reason=swap
```
`Target.getTargets` then lists `{targetId=F2 url=A/beforeunload/next parentFrameId=<F1 middle> attached=false}`. No `attachedToTarget` for it arrives on any session. `Page.getFrameTree` on `page` lists only the main frame, and on `c1` only the B frame.

**Control (auto-attach on `c1`):** `#1227 c1 Target.attachedToTarget session=c2 parentFrameId=F1`, then `c2` commits (`frameNavigated` F2 L5 #1240, load L5 #1247).

### P5: start events against the input command reply, 5 repetitions each
**Answer:** For a form submit, `frameRequestedNavigation` arrives within ±0.4 ms of the input reply, on either side. `frameStartedNavigating` always arrives after the reply (2.2 to 22.4 ms later), because the submission is scheduled as a task. Delta below is event time minus reply time.

| Series | `frameRequestedNavigation` | `frameStartedNavigating` |
|---|---|---|
| POST form by mouse (reply = `mouseReleased`) | 3 before, 2 after (−0.13, −0.04, +0.04, −0.02, +0.13 ms) | 5 after (+13.9, +16.8, +3.8, +16.8, +10.3 ms) |
| GET form by Enter (reply = `keyDown`) | 4 after, 1 before (+0.23, +0.07, +0.33, −6.44, +0.36 ms) | 5 after (+22.4, +19.8, +16.6, +2.2, +7.5 ms) |
| Control: link click (reply = `mouseReleased`) | 5 before (−3.9 to −5.4 ms) | 5 before (−2.4 to −3.0 ms) |

For Enter, the request lands after the `keyDown` reply but before the `keyUp` reply (for example #1526 keyDown reply, #1528 requested, #1529 keyUp reply).

### P6: page session and out-of-process commits
**Answer:** No. The page session never reports `Page.frameNavigated` for an out-of-process frame's commit, neither the initial one nor later ones. Only the child session does.

For the initial load, the page session carries these events for the frame, because at that point the frame still lives in the parent's process: `frameAttached`, `init` L2, `frameRequestedNavigation` `initialFrameNavigation`, `frameStartedNavigating` L3, then `frameDetached reason=swap`. The commit (`c1 frameNavigated` L3, #1954) uses the loader from the page-session start, so pairing a start with its commit must work across sessions by frame id and loader.

**Control (in-process child):** the page session reports `frameNavigated` for both commits (L2 and L3) and `load` for each.

### P7: same-document GET form submission
**Answer:** Yes, with a caveat about the URL.
- **Form whose field matches the page's query** (on `/shop/cart?q=1`, action `#placed`): Chromium emits `frameRequestedNavigation` (`reason=formSubmissionGet`, #2137) and then `frameScheduledNavigation` (#2142) before `navigatedWithinDocument navType=fragment` (#2144). There is no `frameStartedNavigating` and no `frameNavigated`.
- **Form with no fields on a URL without a query:** the submission targets `/shop/cart?#placed`. That URL differs from the current one, so it is a cross-document navigation (`frameStartedNavigating differentDocument` #2201, then `frameNavigated` #2205).

**Control (link `href="#placed"`):** only `frameScheduledNavigation reason=anchorClick` (#2264) precedes `navigatedWithinDocument` (#2267). There is no `frameRequestedNavigation` and no `frameStartedNavigating`.

**Deviation state:** none. The probe file stays in `tmp/probes/` for the implementation unit, as the brief directs. Nothing was committed or deleted.

### P8: a paused target whose session is detached without a resume
**Answer:** `P8: a paused target stays paused after detach`. This is the fifth-round rerun on Chromium 141.0.7390.37 with `--site-per-process`. The probe is `tmp/probes/c6-attach.test.ts`, its beacon server is bound to `127.0.0.1`, and the output is in `tmp/probes/logs/c6-attach-run.txt`.

The page session auto-attaches with `waitForDebuggerOnStart: true`. The child's session is then detached without `Runtime.runIfWaitingForDebugger`. As a result:
- The site B child never runs its inline script, so no beacon arrives within 2 s.
- The parent stays at `readyState` `interactive`, because its `load` waits for the frozen frame.
- The parent session's `Page.getFrameTree` names the child with the URL `:`, not its document URL.

Detach without a resume (`c1` is the child session):
```
#25 page frameStartedNavigating F2 L2 url=B/p8/child?run=paused
#29 page Target.attachedToTarget F2 type=iframe child=c1 waitingForDebugger=true
#30 page > Target.detachFromTarget session=c1
#31 page Target.detachedFromTarget F2 child=c1
#32 page < Target.detachFromTarget
#39 page > Page.getFrameTree  (+2204.7 ms)  children: F2@:
beacon absent; parent readyState interactive
```

**Control (resume, await its reply, then detach):** the child commits and runs, and the parent completes.
```
#79 page Target.attachedToTarget F2 type=iframe child=c3 waitingForDebugger=true
#80 c3 > Runtime.runIfWaitingForDebugger
#82 c3 < Runtime.runIfWaitingForDebugger
#83 page > Target.detachFromTarget session=c3
#86 page frameDetached F2 reason=swap
#88 page lifecycle load F1 (the parent)
#90 page Target.detachedFromTarget F2 child=c3
#91 page < Target.detachFromTarget
beacon arrived; parent tree children: none; parent readyState complete
```
The control's order matches `BrowserPage.#detachChild`: it sends the resume, awaits the reply, and only then sends the detach.

### P2b: the page's own attach follows a reverse swap
**Answer:** The page is built the same way `BrowserContext.#configurePage` builds one. Its new frame session reports the navigation's commit only after the page's resume, and the commit carries the navigation's own loader. The page-session swap follows that commit, and the session's `load` carries the same loader. The record settled `{"url":"http://localhost:38453/frame/done?code=SAVE10&key=","stage":"loaded"}`.

Setup: `BrowserPage` runs on the recording transport, and the page session's auto-attach uses `waitForDebuggerOnStart: true`. The page navigates to `/frame/local`, opens `page.navigation.record(FRAME)` for the in-process voucher frame, and submits it to `localhost`. The fifth-round rerun's full tape is `tmp/probes/logs/c6-attach-p2b.txt` (46 frames), and the printed trace is in `tmp/probes/logs/c6-attach-run.txt`.

Wire positions (`c5` is the new frame session):
```
#188 page frameRequestedNavigation F1 reason=formSubmissionGet url=B/frame/done?code=SAVE10&key=
#191 page frameStartedNavigating   F1 L1
#196 page Target.attachedToTarget  F1 type=iframe child=c5 waitingForDebugger=true
#197 c5 > Page.enable                     #200 c5 < Page.enable
#201 c5 > Runtime.enable                  #202 c5 < Runtime.enable
#203 c5 > Page.setLifecycleEventsEnabled  #208 c5 < Page.setLifecycleEventsEnabled
#204 c5 lifecycle commit L2               (replay, foreign loader)
#209 c5 > Target.setAutoAttach            #210 c5 < Target.setAutoAttach
#211 c5 > Runtime.runIfWaitingForDebugger
#214 c5 frameNavigated F1 L1
#216 page frameDetached F1 reason=swap
#219 c5 < Runtime.runIfWaitingForDebugger
#223 c5 lifecycle load F1 L1
```

### U0 rerun
**Answer:** The rerun matches the recorded answers for P1, P2, P3, P4, P6 and P7; P5 differs on timing only, as listed below. The rerun used `tmp/probes/c6-navigation.test.ts`, rewritten in the fifth round so that no function expression is declared, assigned, or placed in a property inside a function. It ran once under `test:probe` and passed 7 of 7 with exit 0. The output is `tmp/probes/logs/c6-navigation-rerun.txt`.

The recorded report states each reading's answer in prose rather than as raw `answer:` lines. The comparison below therefore sets the rerun's `answer:` lines, and P5's distributions, against that prose.

- **P1: equal.**
  - The start fires in all three placements, on `page`, `page` and `c1`.
  - `startLoader==navigatedLoader` and `loadLoader==navigatedLoader` are true in all six rows.
  - The control rows show `anchorClick`.
- **P2: equal answer; the wire positions differ.**
  - Forward: the start is on `c1` (#553, #558), and `c1` detaches.
  - Reverse with a wait: the start is on `page` (#589, #590), and the new session's `frameNavigated` (#605) follows its `Page.enable` reply (#596).
  - Reverse without a wait: no `frameNavigated` arrives.
  - The control stays on `c1` and nothing detaches.
  - The record has #563, #566, #595 and #596.
- **P3: equal.**
  - `c1` reports `load` on its `frameNavigated` loader.
  - A replayed `commit` and `DOMContentLoaded` arrive on a foreign loader.
  - The navigation reports `init`, `DOMContentLoaded` and `load` on `c1`.
  - Control: `c1` reports no lifecycle event, and `page` reports only `init`.
- **P4: equal.**
  - With auto-attach off, the nested target attaches through no session, and `c1`'s `frameAttached` names the middle frame as parent.
  - Control: the nested target attaches through `c1`, with `parentFrameId` set to the middle frame.
- **P5: the start-after-reply answer holds for every form repetition; three timing details differ.** `frameStartedNavigating` follows the reply in all 10 form repetitions (+4.9 to +37.2 ms). The input replies took longer on this run (send to reply 1.1 to 29.9 ms).
  - **Mouse series (equal):** `frameRequestedNavigation` falls within ±0.4 ms of the reply, 3 before and 2 after (−0.31 to +0.20 ms). This matches the record.
  - **Enter series (differs):** the `frameRequestedNavigation` deltas against the `keyDown` reply are +2.26, +0.85, +3.58, −13.59 and +0.45 ms in repetitions 1 to 5. That is 4 after and 1 before, which matches the record's split, but every one of the five lies outside the record's ±0.4 ms bound. The start still follows the reply in every repetition.
  - **Link control (differs):** both events arrive after the reply in repetitions 1, 2 and 5 (requested +0.07 to +0.47 ms, started +1.31 to +21.01 ms). The record had all 5 before.
- **P6: equal.**
  - The page session reports no `frameNavigated` for the out-of-process frame.
  - The in-process control reports both commits on `page`.
- **P7: equal answer; the wire positions differ.**
  - The matching-field form emits `frameRequestedNavigation` and `frameScheduledNavigation` (`formSubmissionGet`) before `navigatedWithinDocument` (`fragment`), with no start and no commit. Positions: #2140, #2142, #2144 (recorded #2137, #2142, #2144).
  - The form without fields navigates cross-document.
  - The link control emits only `frameScheduledNavigation` (`anchorClick`, #2268).
