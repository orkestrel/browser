# C7 probe report

### P9

**Finding:** on Chromium 141 with `--site-per-process`, the inner document's session reports the middle frame's `Page.frameRequestedNavigation`, and the middle frame's own session reports its `Page.frameStartedNavigating`. The request's URL and the start's URL are equal. This matches the premise of the page's reason handoff (the request and the start arrive on two sessions), so F7 keeps the handoff.

**Setup:**
- Probe: `tmp/probes/c7-parent.test.ts`, run with `npm run test:probe -- tmp/probes/c7-parent.test.ts`; exit 0, 2 passed, Chrome/141.0.7390.37.
- Run output: `tmp/probes/logs/c7-parent-run.txt`.
- Tapes: `tmp/probes/logs/c7-parent.txt` and, for the control, `tmp/probes/logs/c7-parent-control.txt`. Each tape lists the tagged navigation lines, then every frame of the wire.
- Page: the fixture page `/frame/nested` on site A (`127.0.0.1`) frames `/frame/middle` from site B (`localhost`), which frames `/frame/inner` from site A.
- Topology: the inner frame is out of process relative to its parent. `Target.setAutoAttach` gives it its own session under the middle frame's session.
- Submission: the probe submits the inner `Coupon` form with `requestSubmit()` after setting its target.
- Session labels: each session is labelled by the frame its iframe target is, because an iframe target's id is its frame's id.

**Result with `target="_parent"`:** the form navigates the middle frame. The events about the middle frame are the following.

```text
session(inner)  Page.frameRequestedNavigation frame=middle reason=formSubmissionGet disposition=currentTab url=http://127.0.0.1:PORT/frame/done?code=SPRING
session(inner)  Page.frameRequestedNavigation frame=middle reason=formSubmissionGet disposition=currentTab url=http://127.0.0.1:PORT/frame/done?code=SPRING
session(middle) Page.frameStartedNavigating   frame=middle loader=9B809E42 navigationType=differentDocument url=http://127.0.0.1:PORT/frame/done?code=SPRING
page            Page.frameNavigated           frame=middle loader=9B809E42 url=http://127.0.0.1:PORT/frame/done?code=SPRING
```

- The request arrives twice, both times on the inner session. The start arrives on the middle session.
- The page's ownership rule refuses the request as a step, because the middle session owns the middle frame. The start alone reaches the record.
- The two URLs are equal: `http://127.0.0.1:PORT/frame/done?code=SPRING`.
- The start carries `navigationType=differentDocument` and no reason.
- The page session reports the commit, because the destination is on site A.

**Control with `target="_self"`:** the form navigates the inner frame. The request, the start, and the commit all arrive on the inner session, and the request's and the start's URLs are equal.
