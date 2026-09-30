# J0 probe report: the journeys instruments on Chromium 141

The three readings ran on Chrome/141.0.7390.37 (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, headless, `SERVICE_BROWSER_ARGS` plus `--site-per-process`), 2026-09-30. Each reading ran twice inside one file, and the file ran in two separate invocations. Every run returned the same answer.

- Claim 3: the reading supports it. Resolution by role and whole normalized name clicked the right element on the changed page. With a duplicate name, the resolution returned two matches and sent zero input.
- Claim 4: the reading limits it. A CSS query cuts matches down to the role-and-name outline only when `find` also gets `role` or `name`. `find({ css })` alone returns elements whose role and name differ from the step's, and elements that the outline does not list. Claim 4 holds only when `locateBrowserTarget` never reads `css`.
- Claim 12: the reading supports it for every listed gesture, with limits. The projection rule in the R3 section, applied to the listener's binding stream, gives the same step list as the fixture's own event log under the same rule. This match needs the listener on every attached out-of-process frame session. With the page session alone, an out-of-process click disappears and no gap is recorded. No inbound CDP frame held the password or its first 4 characters.

The instrument is `tmp/probes/journeys/journeys.test.ts`. The tapes are `tmp/probes/journeys/logs/{r1,r2,r3}-run{1,2}.txt`. Each tape opens with the reading's lines, followed by every CDP frame in wire order.

## R1 (claim 3): exact-name resolution over a changed page, then a duplicate

The probe server serves these routes:

- `/r1/record` holds `textbox "Title"`, `button "Archive"`, `button "Delete"` (`#delete.btn.danger`), `button "Delete all"`, and `link "Help"`.
- `/r1/replay` rewrites every id and class and reorders the controls. It moves `Delete` into a `section`, puts `Delete all` first, and puts the textbox last.
- `/r1/duplicate` is the replay page plus a second `button "Delete"` in an `aside`.

Each page's script posts every click, with the button's id and `isTrusted`, to the server's event log. The resolution calls `page.elements.find({ role, name })`. That query matches substrings case-insensitively, so the probe keeps only matches whose `normalizeBrowserName` equals the recorded name, and clicks only when exactly one match remains.

The following excerpt is from `logs/r1-run1.txt`, second invocation:

```text
record /r1/record: find({ role: 'button', name: 'Delete' }) -> e3 button "Delete", e4 button "Delete all"; exact -> e3 button "Delete"
recorded target: {"role":"button","name":"Delete","reference":"e3","css":"#delete"}
replay /r1/replay: recorded reference after the navigation -> undefined (dropped)
replay: find -> e6 button "Delete all", e7 button "Delete"; exact -> e7 button "Delete"
replay: event log clicks 1: id=k1 trusted=true; mousePressed on tape 1
duplicate /r1/duplicate: find -> e11 button "Delete all", e12 button "Delete", e16 button "Delete"; exact -> e12 button "Delete", e16 button "Delete"
duplicate: event log clicks after 750 ms 0; mousePressed on tape 0
control: a direct click on the first duplicate -> event log clicks 1; mousePressed 1
  #   57 page > Page.navigate {"url":"http://127.0.0.1:34249/r1/replay?run=r1-1"}
  #  115 page > Input.dispatchMouseEvent {"type":"mousePressed","x":35.265625,"y":43.5,"button":"left","buttons":1,"clickCount":1}
  #  117 page > Input.dispatchMouseEvent {"type":"mouseReleased","x":35.265625,"y":43.5,"button":"left","buttons":0,"clickCount":1}
  #  124 page > Page.navigate {"url":"http://127.0.0.1:34249/r1/duplicate?run=r1-1"}
  #  180 page > Input.dispatchMouseEvent {"type":"mousePressed", ...}   the control click, after the reading
```

Frames #124 through #179 of the duplicate navigation carry no input command. The probe counted the duplicate reading's `mousePressed` frames before it sent the control click.

The answer line was identical in all four runs:

```text
exact name resolves 1 of 2 substring matches on the changed page; the click reached id=k1 (1 click); the duplicate page yields 2 exact matches and 0 clicks, 0 mousePressed
```

For claim 3, the reading supports feasibility on the page placement:

- The changed page resolves by role and whole name.
- The trusted click reaches `#k1` and no other element.
- A duplicate name yields two matches, and no input frame leaves the client.
- The recorded reference `e3` does not survive the navigation: `elements.element('e3')` returns `undefined`. That matches § 2's ruling that a reference is evidence and never a lookup.

The reading does not exercise `find({ ..., exact: true })` (J3) or `locateBrowserTarget` (J2), because neither exists at `6d8e8ed`. The substring query's extra match, `Delete all`, shows what the J3 mutation proof must catch.

## R2 (claim 4): a CSS query against the role-and-name outline

`/r2` holds a `div.banner` ("Free shipping on orders over 40"), `button "Save"`, `button "Cancel"` (`#cancel`), and `link "Help"`. The step under test is `{ role: "button", name: "Submit order", css: "#cancel" }`: its role and name match nothing, and its CSS matches exactly one element.

The following excerpt is from `logs/r2-run1.txt`:

```text
outline before the queries:
page "Checkout" http://127.0.0.1:…/r2?run=r2-1
# Checkout
Free shipping on orders over 40
e1 button "Save"
e2 button "Cancel"
e3 link "Help"
(3 of 3 elements)
semantic: the step role and name: find({"role":"button","name":"Submit order"}) -> []
css only: #cancel, one element whose role and name differ from the step: find({"css":"#cancel"}) -> e2 button "Cancel"
combined: the step role and name with #cancel: find({"role":"button","name":"Submit order","css":"#cancel"}) -> []
control: the #cancel element role and name with #cancel: find({"role":"button","name":"Cancel","css":"#cancel"}) -> e2 button "Cancel"
css only: .banner, one element outside the outline: find({"css":".banner"}) -> e4 generic ""
combined: role button with .banner: find({"role":"button","css":".banner"}) -> []
outline after the queries: (unchanged; e4 absent)
  page > DOM.querySelectorAll {"nodeId":55,"selector":".banner"}
  page < DOM.querySelectorAll {"nodeIds":[65]}
  page > DOM.describeNode {"nodeId":65}
  page < DOM.describeNode {"node":{…,"backendNodeId":10,"nodeName":"DIV","attributes":["class","banner"]}}
```

The answer line was identical in all four runs:

```text
css alone returns 1 element(s) for #cancel whose role and name differ from the step and 1 for .banner, 1 of them absent from the outline (e4 generic ""); role and name with #cancel return 0; the control role and name with #cancel return 1
```

For claim 4, the reading limits the claim. `BrowserElementManager.find` gives a CSS query two behaviors:

- With `role` or `name` in the same query, it returns the intersection. The step's own query returns `[]`, and the control query returns `e2`.
- With `css` alone, it returns every element the selector matches. That includes an element whose role and name differ from the step's (`e2 button "Cancel"`). It also includes an element the outline never lists: `e4 generic ""`, which gets a fresh reference minted by the CSS path.

§ 2's sentence "on the CDP placement a CSS query intersects the role-and-name outline, so a selector can never resolve what the semantic search did not" is therefore true only of the combined query. Claim 4's refusal (`BROWSER_JOURNEY_TARGET` even when `css` matches exactly one element) holds only when `locateBrowserTarget` never issues a query that carries `css`. A CSS-only fallback resolves `#cancel` to `button "Cancel"`. J2 must keep `css` out of every query that `locateBrowserTarget` issues, and J5's claim-4 proof must include the `#cancel` shape.

## R3 (claim 12): the gesture projection against the fixture event log

`/r3/page` (`127.0.0.1`) holds these controls and frames:

- `button "Add note"`
- the `Note` form: `textbox "Title"` and a submit `button "Save note"`
- the `Find` form: `textbox "Search"`, prefilled `kettle`, with no submit button
- `combobox "Speed"` (`standard`, `express`)
- `combobox "Size"` (two options with value `m`: `Medium` and `Medium tall`)
- `listbox "Toppings"` (`multiple`, `size=3`)
- `button "Discard draft"`, whose click calls `confirm('Discard the draft?')`
- the `Sign in` form: `textbox "Password"` (`type=password`)
- a same-origin frame, `/r3/child`, holding `button "Accept terms"`
- an out-of-process frame from `localhost`, `/r3/remote`, holding `button "Pay now"`
- a `sink` frame that both forms target

Each document's own script (the oracle) posts `click`, `input`, `change`, `keydown`, `submit`, `focusout`, and the `confirm` answer to the server. It uses the role and name that the fixture declares in `data-role` and `data-name`. For a password field, it posts a marker and the length.

The recorder's listener is separate. It uses `Runtime.addBinding`, `Page.addScriptToEvaluateOnNewDocument`, and `Runtime.evaluate` on the page session. On the out-of-process frame's auto-attached session, it uses `Page.enable`, `Runtime.addBinding`, and `Page.addScriptToEvaluateOnNewDocument` before `Runtime.runIfWaitingForDebugger`, then `Runtime.evaluate`. The listener stashes each event target in its document. The probe reads the target's role and name through `Accessibility.getPartialAXTree` while the node is live.

The probe drives ten gestures through CDP `Input` on the page session:

1. G1: a click on `Add note`.
2. G2: typing `Pasta night` into `Title`, then Enter.
3. G3: Enter in the unedited `Search`.
4. G4: ArrowDown on `Speed`.
5. G5: Ctrl+click on `Olives` in `Toppings`.
6. G6: a click on `Accept terms` in the same-origin frame.
7. G7: a click on `Pay now` in the out-of-process frame.
8. G8: a click on `Discard draft`, with the `confirm` accepted through `Page.handleJavaScriptDialog`.
9. G9: typing `teal-Heron-42` into `Password`, then Tab.
10. G10: ArrowDown on `Size`.

### The projection rule

`projectGestures` in the probe implements this rule. `PROJECTION_RULE` prints the same text:

- Any event that emits a step first closes the open edit, emitting its `type` step.
- A `click` in a document that is not the top document emits `unresolved` with the gap `the element is in a child frame`.
- A `click` on a `select` or an `option` emits nothing; the select's `change` carries the gesture.
- A `click` with `detail` 0 after an Enter `keydown` and before the next `submit` emits nothing; the Enter carries it.
- Any other `click` emits `click` with the target's role and name.
- An `input` on a text or password control opens an edit on that control or extends the open one; a password edit carries a secret marker, never a value; an `input` on any other control emits nothing.
- A `focusout` from the edited control closes the edit: `type` with the edit's text, or with `{ parameter }` named after the control in lower camel case for a password.
- An Enter `keydown` on the edited control closes the edit as `type` with `submit: true` when a form owns the control, else as `type` followed by `press` Enter; an Enter `keydown` with no open edit emits `press` with `key: Enter`.
- A `change` on a single select emits `type` with the option's value when the first option carrying that value is the selected one (the round trip through the element's `select`), else `unresolved` with the gap `the option does not round-trip`; a `change` on a multiple select emits `unresolved` with the gap `a multiple selection`; a `change` on a text control emits nothing.
- A closed native dialog emits `unresolved` with the gap `a native dialog answer` and records no answer.
- A `submit`, a `keydown` other than Enter, and a `focusout` from a control without an open edit emit nothing; a main-frame navigation closes the open edit and emits nothing.

### Per gesture: what the recorder emits

The following output is from `logs/r3-run1.txt`, second invocation; all four runs printed the same steps:

```text
G1 click button Add note
  every session: click button "Add note"                              page session only: same
G2 type into Title then Enter
  every session: type textbox "Title" {"text":"Pasta night","submit":true}     page session only: same
G3 Enter in unedited Search
  every session: press {"key":"Enter"}                                page session only: same
G4 single select Speed (ArrowDown)
  every session: type combobox "Speed" {"text":"express"}             page session only: same
G5 multiple select Toppings (Ctrl+click Olives)
  every session: unresolved gap="a multiple selection" (subject listbox "Toppings")    page session only: same
G6 click in same-origin child frame
  every session: unresolved gap="the element is in a child frame" (subject button "Accept terms")    page session only: same
G7 click in out-of-process child frame
  every session: unresolved gap="the element is in a child frame" (subject button "Pay now")    page session only: nothing
G8 click Discard draft, confirm() accepted
  every session: click button "Discard draft" ; unresolved gap="a native dialog answer"    page session only: same
G9 type into Password then Tab
  every session: type textbox "Password" {"text":{"parameter":"password"}}    page session only: same
G10 single select Size whose value does not round-trip
  every session: unresolved gap="the option does not round-trip" (subject combobox "Size")    page session only: same
listener on every session equals the fixture projection: true
listener on the page session only equals the fixture projection: false
listener present in each out-of-process frame from Page.addScriptToEvaluateOnNewDocument before resume, before any Runtime.evaluate: /r3/remote true
password: 13 password input payloads, each a marker without a value; inbound frames holding the password 0, holding its first 4 characters 0; control: inbound frames holding the Title text 5
```

The following raw-stream excerpt shows the Enter-caused click, the multiple-select order, and the dialog:

```text
#863 page Runtime.bindingCalled {"type":"keydown",…,"control":"text","form":true,"key":"Enter"}
#865 page Runtime.bindingCalled {"type":"change",…,"control":"text","form":true}
#867 page Runtime.bindingCalled {"type":"click",…,"control":"button","form":true,"trusted":true,"detail":0}
#871 page Runtime.bindingCalled {"type":"submit",…}
#917 page Page.frameNavigated {"frame":{…,"parentId":"BB14…","name":"sink","url":"…/r3/sink?title=Pasta+night"}}
#968 page Runtime.bindingCalled {"type":"input",…,"control":"select-multiple"}
#970 page Runtime.bindingCalled {"type":"change",…,"control":"select-multiple"}
#972 page Runtime.bindingCalled {"type":"click",…,"control":"option","detail":1}
#1014 child(/r3/remote) Runtime.bindingCalled {"type":"click","index":0,"top":false,…,"detail":1}
#1029 page Runtime.bindingCalled {"type":"click",…,"control":"button","detail":1}
#1031 page Page.javascriptDialogOpening {…,"message":"Discard the draft?","type":"confirm"}
#1033 page Page.javascriptDialogClosed {…,"result":true,"userInput":""}
#1044 page Runtime.bindingCalled {"type":"input","index":26,"top":true,"control":"password","form":true,"trusted":true,"secret":true}
```

The answer line was identical in all four runs:

```text
11 steps: click button "Add note" ; type textbox "Title" {"text":"Pasta night","submit":true} ; press {"key":"Enter"} ; type combobox "Speed" {"text":"express"} ; unresolved gap="a multiple selection" (subject listbox "Toppings") ; unresolved gap="the element is in a child frame" (subject button "Accept terms") ; unresolved gap="the element is in a child frame" (subject button "Pay now") ; click button "Discard draft" ; unresolved gap="a native dialog answer" (subject  "") ; type textbox "Password" {"text":{"parameter":"password"}} ; unresolved gap="the option does not round-trip" (subject combobox "Size") | page session only: 10 steps | fixture agrees with every-session listener true, with page-only listener false | password value in inbound frames 0
```

### Claim 12 findings

The reading supports claim 12 for the listed gestures: one step per gesture, with role and exact name. The two streams are separate mechanisms that agree: the binding with CDP accessibility names, and the server log with declared names. The comparison can fail: the page-session-only projection disagrees on G7. The reading also sets the following limits for J6:

- **Out-of-process frames.** The listener must run on every auto-attached frame session. With the page session alone, the G7 click produces no event, so the recorder emits nothing rather than the § 3 gap. On the paused child session, `Page.addScriptToEvaluateOnNewDocument` before `Runtime.runIfWaitingForDebugger` installed the listener when `Page.enable` preceded it (all four runs). One development run without `Page.enable` found the listener absent; that observation was not repeated.
- **Role and name lookup.** Each document keeps its own target stash, so the lookup must be keyed by session, `executionContextId`, and index. The same-origin child shares the page session, and its index 0 collides with the main document's index 0.
- **Enter against the click it causes.** Implicit submission dispatches a trusted `click` with `detail` 0 on the default button, after the Enter `keydown` and the field's `change`, and before `submit`. A form with no submit button produces no click. The rule tells the two apart by `detail` 0 after an Enter.
- **Multiple select.** A Ctrl+click fires `input` and `change` on the `select` before the `click` on the `option`.
- **Password.** The listener sends a marker for a password `input` and sends a `keydown` only for Enter; a `keydown` payload that carried `key` would expose every keystroke. At `6d8e8ed`, `BROWSER_CODEGEN_SOURCE` in `src/core/constants.ts` sends `value` for `type=password`, because `password` is in its `fillableTypes` set. J6 must change that source. The probe read this source; it did not run it.
- **Native dialog.** The recorder sees the answer only as CDP `Page.javascriptDialogClosed` (`result`, `userInput`) on the page session, after the click's binding call. The probe answered through `Page.handleJavaScriptDialog`; a person's answer in a headed browser was not exercised.
- **Roles.** Chromium 141 reports `combobox` for a single select, `listbox` for a multiple select, `option` for its options, `textbox` for `type=password`, and `generic ""` for an unnamed `form`.
- **Not exercised:**
  - A click into a text field before typing. The probe focuses fields with in-page `focus()`, and the rule as stated would emit a `click` on the textbox before the `type`, which § 3 does not rule.
  - A main-frame navigation closing an open edit. The only navigation is the `sink` frame's.
  - A person's native dialog answer in a headed browser.

## Commands and exit codes

Every command ran through `env -C /home/user/browser`:

| Command | Exit | Result |
| --- | --- | --- |
| `npx tsc --noEmit -p tmp/probes/journeys/tsconfig.json` (a scratch config extending the root `tsconfig.json` with `include: ["./*.test.ts"]`, deleted afterwards) | 0 | no diagnostic |
| `npx oxlint --config .oxlintrc.json --deny-warnings tmp/probes/journeys/journeys.test.ts` | 0 | no output |
| `npx oxfmt --config .oxfmtrc.json --check tmp/probes/journeys/journeys.test.ts` | 1 | format issues in the probe file; not rewritten, because the brief forbids `format` |
| `npm run test:probe -- tmp/probes/journeys/journeys.test.ts` (first invocation) | 0 | 1 file, 7 tests passed; R1, R2, and R3 each ran twice and agreed |
| `npm run test:probe -- tmp/probes/journeys/journeys.test.ts` (second invocation) | 0 | 1 file, 7 tests passed; same answer lines as the first invocation |

## Deviations

- **Fixture server.** The pages come from a `node:http` server inside the probe, bound to `127.0.0.1` on an ephemeral port, because `tests/setupServer.ts` serves no page with an event log. The probe imports `createTempDirectory`, `readServerPort`, and `reservePort` from that file and does not import `createFixtureServer`.
- **The sink frame.** Both R3 forms submit into a named `sink` frame. The submission is real and navigates a child frame, and the page keeps its listener and nodes for the next gesture.
- **An extra gesture.** G10, the non-round-tripping select, extends the brief's list because claim 12 names that case.
- **Programmatic focus.** R3 focuses each field with in-page `focus()` before typing, and G9 leaves the field with a trusted Tab.
- **Tape location.** The tapes are in `tmp/probes/journeys/logs/`.
- **The instrument stays.** Design § 12 names the J0 probe file and its logs as the unit's deliverables, and J5 and J6 depend on them. Promoting a reading into a mirrored test would touch tracked files, which this lane may not do. The scratch `tsconfig.json` was deleted.
- **Tracked files.** `git status --short` is empty; `tmp/` is ignored and no tracked file changed.
