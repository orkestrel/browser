# U16 subjective lane report (Opus `reviewer`, read-only, verbatim)

## U16 review, subjective lane: `/home/user/browser` at 9bbe834 and `/home/user/ollama` at 9f46eac

This lane covers design fit, API and vocabulary, architecture shape, and guide voice. I edited nothing and spawned nothing. I read the sources as they sit on disk. I ran no command, so I could not confirm the commits, and none of the numbers below come from a run of mine.

The verdict is FAIL. The blocking item is carried finding 1: a click that submits a form returns a view of the page it just left. Carried findings 3, 6, 7 and 8 and outside findings O1–O4, O6–O15 are required changes.

### Rulings on the eleven carried findings

**1. Stale view after a form submit: a defect to fix now (blocking).**
- **The brief cites the wrong transcript.** `v4/click-1.json:189` and `v5/click-1.json:189` both show `page "Your cart" …/cart` after `Clicked e28 button "Add to cart".`. The stale receipt is in `/home/user/ollama/tmp/probes/logs/c5/click-1.json:94`, which shows `page "Cedar Tea Tray" …/product/p3` with `e28 button "Add to cart"` still listed. Ledger line 316 has it right.
- **The flow:** the store answers the form's POST with a 303 redirect (`/home/user/ollama/tests/setupStore.ts:564`).
- **Why it happens:** `#settle` races the input command against `#requested` (`/home/user/browser/src/core/BrowserToolset.ts:770-777`). A form submission schedules its navigation as a task after the click finishes. When the mouse release settles first, `url` is `undefined` and `:776` captures the old document.
- **Same path elsewhere:** `type` with `submit: true` (`:488-493`, which presses Enter through `/home/user/browser/src/core/elements/BrowserElement.ts:162-165`) and `press` (`:513`).
- **Ruling:** yes, the settle must wait for a navigation that a form submit starts. The vocabulary promises that every action's receipt carries the fresh view (`/home/user/browser/guides/browser.md:2493`, rows `:2279-2280`). A stale view that still lists `Add to cart` invites a second, consequential submit.
- **Smallest fix (event-driven, no grace timer):**
  - Before the input is sent, install a one-shot capture-phase `submit` listener in the target document's isolated world. Put the compiled function in `src/core/compilers.ts`. This mirrors the in-page face, which already observes `submit` (invariant 20).
  - After the command settles, read whether a `submit` fired with `defaultPrevented === false`. That flag is final by then, because every listener has run before `Input.dispatch*` resolves.
  - If one fired, `#settle` waits on `#requested` under the deadline it already applies at `:779-796`. If none fired, keep today's path.
- **Proof:**
  - A service case over a POST form answered with 303 whose receipt must equal `page "Your cart" …`.
  - A control whose submit handler calls `preventDefault`: same page, no wait.
  - Tighten `matchesToolReceipt` (`/home/user/browser/tests/setupService.ts:340-347`) so its still-loading branch requires the destination's view, not any `page "` prefix.
- **Referred to the objective lane:** which isolated world owns the listener for an out-of-process frame.

**2. `@orkestrel/agent` JSON-encodes string tool results: a fleet defect in another package.**
- Confirmed at `/home/user/ollama/node_modules/@orkestrel/agent/dist/src/core/index.js:2192`: `content: outcomeResult.success ? JSON.stringify(outcomeResult.value) : outcomeResult.error`.
- So the model reads every view as one quoted string with `\n` and `\"` escapes (`v5/click-1.json:30,49,68`), while an error arrives raw. One channel carries two encodings.
- Fix it in `@orkestrel/agent`: pass a string value through unchanged. Referred to the Orchestrator.
- The browser tree records nothing. The evidence paragraph at `guide:2495` was measured under the escaped encoding, so rerun the store proof after the agent fix before that paragraph stands.

**3. D3 and D4 (element interface grouping): D3 is a defect to fix now; D4 is a fleet defect to record.**
- **D3:** `BrowserElement implements BrowserPageElementInterface` (`/home/user/browser/src/core/elements/BrowserElement.ts:43`). Every other class pairs `{Entity}` with `{Entity}Interface` (`guide:1237-1246`, names.md). That mismatch is what defeats the parity test's grouping.
- `BrowserViewInterface` already shows the right shape: a shared base with its own table and no class of its name (`guide:1362`).
- **Fix:**
  - Rename the class `BrowserPageElement` (file, barrel, `guide:147`, `:1239`).
  - Give `BrowserElementInterface` its own six-row Methods table.
  - Delete the workarounds at `guide:1248`, the last sentence of `:1460`, and the `BrowserElementInterface` clause of invariant 10 (`:2351`).
- **D4:** route the empty-body read to `@orkestrel/guide`. Until it is fixed, `BrowserDOMElementInterface` (`/home/user/browser/src/browser/types.ts:66`) keeps no table; record that in one sentence.

**4. D9 (the in-page view does not refuse an oversized document): resolved.**
- `BROWSER_RESULT_LIMIT` protects the CDP transport frame (`guide:159`, `:208`, invariant 8). The in-page face has no such frame.
- The guide claims no in-page refusal, and invariant 18 bounds every tool result at `limit`.

**5. C4 D1 (a child-frame navigation triggers the one capture retry): resolved.**
- `#drop` moves `#changes` (`/home/user/browser/src/core/elements/BrowserElementManager.ts:511-514`), so `:110-112` reports the rejection as `GONE`, and the toolset retries once inside the same deadline (`BrowserToolset.ts:895-909`).
- Invariant 15 already treats a child-frame navigation as a page change, the cost stays inside `BROWSER_TOOL_TIMEOUT_MS`, and both notes end with `call look`.

**6. `read` with a positive first offset answers from 0: a limit to record (required).**
- The behavior at `BrowserToolset.ts:379-391` is correct: an offset only means something against the capture that named it.
- The guide never says so (`:2251`, `:2266`). Add under Receipts: "A `read` whose offset no earlier `read` of the same document named, or whose document changed, restarts at 0, and its footer shows the range it returned."

**7. C3 deviations: two are recorded; one needs a clause (required).**
- The failed holder setup is recorded (`guide:1386`, invariant 6). Direct construction is recorded (same places).
- Not recorded: a failed `Target.setDiscoverTargets` is sent again only when the next context-constructed page is built on that connection. Add that clause to invariant 6, naming `sync()` as the recovery.

**8. Error codes around page creation: partly a defect to fix now.**
- `BROWSER_PAGE_CLOSED` is resolved.
- A context shutdown throws uncoded `Browser context is closed` (`/home/user/browser/src/core/BrowserContext.ts:133`, `:150`) and `…closed during page creation` (`:207`). Code all three `BROWSER_CONTEXT_CLOSED` and list the code at `guide:217`.
- A CDP attach failure that propagates as `CDPError` or `CDPConnectionError` is resolved: those already carry codes (`guide:205-206`).

**9. Chromium 141 has no `WebMCP` domain: resolved as a recorded limit.**
- It is recorded at `guide:2334`, invariant 25, and `README.md:23`.
- O8 and O9 cover defects in how it is recorded.

**10. Mutation controls discriminate without uniquely identifying: resolved.**
- A mutation control proves discrimination: its named test reddens. No verdict relied on unique identification, so nothing needs recording beyond the review tables.

**11. The failing `/home/user/ollama` `npm test` case: a recorded defect for that repository.**
- `tests/src/core/integration.test.ts:134` drives `createRelayProvider` cancellation and imports nothing from `@orkestrel/browser` (`:5-40`). The campaign's browser consumer does not own it.
- Referred to the Orchestrator: whether a red `npm test` blocks the ollama publish gate is outside this lane.

### Findings outside the carried findings

**O1 (required). The click evidence overstates the run.**
- `guide:2495` says "the receipt showing the cart page". The proof does not assert the receipt (`/home/user/ollama/tests/service/browser.test.ts:137-145`), and the c5 run showed the stale page.
- The paragraph also leaves out that in v5 the model then called `wait` five times with invented text and ended at the turn limit with `"answer": ""` and `"partial": true` (`v5/click-1.json:76-164`, `:232-233`). The prompt tells it to call `wait` once, and the paging answer's omission is disclosed.
- Fix: after the carried finding 1 fix, assert the Add-to-cart receipt carries `page "Your cart"` and state the `wait` loop. Until then, delete the receipt clause.

**O2 (required). The prompt description is false.**
- `guide:2493` says the prompt "says that the model sees the page only through tools". The prompt at `:2505-2512` (and `setupStore.ts:114-121`) has no such sentence.
- Describe the sentences it does carry: call a tool before answering, the first message shows the `look` view, never invent a reference, answer in one sentence.

**O3 (required). The Surface fence contradicts its own prompt.**
- At `guide:33-67` the prompt states "The first message shows the page as look returns it", but line 63 sends a bare question with no view.
- Seed the first message with the `look` result, as `:2517-2531` does.

**O4 (required). `type`'s `submit` parameter says the wrong thing.**
- `/home/user/browser/src/core/constants.ts:564` reads "Whether to press Enter afterward." That is false for the in-page face, which calls `requestSubmit()` (`/home/user/browser/src/core/types.ts:1798-1802`), and it disagrees with the tool's own description at `:553`.
- Use "True to submit its form after typing." Rerun the store proof afterwards.

**O5 (optional). Tool-description voice.**
- `dialog`, `tabs`, and `switch` are imperative (`constants.ts:610`, `:625`, `:637`); the other seven are third-person indicative.
- `wait` (`:594`) does not say the text must appear on the page; v5 shows invented sentences.
- Both are model-facing, so change them with a rerun.

**O6 (required). The Receipts table is incomplete.**
- Missing receipts a model reads:
  - `wait`'s timeout, `"TEXT" did not appear within 5 s.` (`v5/click-1.json:197`)
  - `Typed "…" into …` and `… and submitted the form` (`BrowserToolset.ts:472`, `:490`)
  - `Pressed …`
  - the `navigate`, `tabs`, and `switch` receipts
  - a handled dialog (`/home/user/browser/tests/service/toolset.test.ts:746`)
- `COUNT` (`guide:2272`) is used but never defined at `:2266`, and `MESSAGE` is defined but no row uses it.

**O7 (required). Element-refusal wording contradicts itself.**
- `guide:1460` says every refusal's message "names the next call". The summary at `:203`, mirrored from `/home/user/browser/src/core/errors.ts:30`, says "with a reason and a recovery instruction".
- Invariant 7 (`:2348`) and row `:2284` (`Element e2 is not editable.`) say only `GONE` names `look`. Correct `errors.ts:30` and `:1460` to match.

**O8 (required). Invariant 25 merges two unrelated limits.**
- `guide:2366` adds the Edge Windows launcher limit "for the same reason". The reasons differ: no `WebMCP` domain on Chromium 141, versus no Windows host with Edge. Invariant 13 (`:2354`) points at "limit 25" for the Edge fact.
- Split out an Edge limit and repoint invariant 13. Invariants 24 and 25 also restate the gap entries at `:2330` and `:2334`; link those entries instead.

**O9 (required). Third-party claims are unlinked** (writing.md: paraphrase and link).
- `guide:2293`: blink-dev, 2026-05-15, Chrome 157.
- `guide:2334` and `README.md:23`: Chrome DevTools MCP 1.10.1 on Chrome 150.

**O10 (required). The error codes are an undeclared open set.**
- `src` throws about 25 distinct codes. `guide:217` names four, and invariant 7 promises machine-readable codes.
- Examples: `BROWSER_TOOLSET_RESERVED`, `_DIALOG`, `_LIMIT`, `_SCHEME`, `_TAB`, `_PAGE`, `_ENDED`, `_CONTEXT`; `BROWSER_WAIT_TIMEOUT`, `BROWSER_NAVIGATION_TIMEOUT`, `BROWSER_DOCUMENT_SUBMIT`, `BROWSER_ELEMENT_QUERY`, `BROWSER_JSON_ERROR`, `BROWSER_HAR_ERROR`.
- Add a table under the core Errors section naming every code that reaches a caller, with what throws it and when.

**O11 (required). The in-page options type does not match its entity.**
- `BrowserDocumentOptions` (`/home/user/browser/src/browser/types.ts:22`) configures `BrowserDOMView`. names.md requires `{Entity}Options`, and the in-page face already alternates "DOM" and "Document" for one concept.
- Rename it `BrowserDOMViewOptions` (`:22`, `:32`, `:39`, `guide:1222`).

**O12 (required). Writing-rule violations in the guide.**
- `may` at `:940`, `:1697`, `:2417`.
- Temporal `once` at `:1342`, `:1358`, `:1411`, `:1766`, `:2011`, `:2012`, `:2027`, `:2028`.
- In the Patterns prose: "if desired" (`:2425`), "merely" (`:1692`, `:2462`), "launched/adopted" (`:2447`), the fragment "Useful when…" (`:2476`), the undefined `myTransport` (`:2482`), and the `ctx` abbreviation (`:888`, `:1321`).
- British "summarised" (`:2495`).
- `:2246` and `constants.ts:499-500` give the required-parameter rule as run history. State the cause with its version instead: "because Ollama 0.34.4's streamed parser rejects a call to a tool that declares none" (ledger 52-56).
- Where a summary cell mirrors TSDoc, fix the TSDoc so parity holds.
- Sweeps I ran, case-insensitive, over `/home/user/browser/guides/browser.md`:
  - `\b(should|may|just|simply|easy|e\.g\.|i\.e\.|etc\.|via|currently|leverage|utilize|in order to|allows you|and/or|please|performant|robust)\b` matched only the three `may` hits.
  - `\b(now|new|latest|once|since|above|below|master)\b` matched the temporal `once` hits I listed. The other matches are counts, "new-document", `new` in code, or text inside a fence.

**O13 (required). Campaign identifiers in permanent text.**
- The guide's invariant 19 (`:2360`) cites "the P14 and P20 cases" and invariant 25 cites "its P15 case".
- 18 test titles open with `P\d+` or `claim \d+` (`tests/service/toolset.test.ts`: 7, `tests/service/browser.test.ts`: 10, `tests/setupServer.test.ts`: 1).
- "in every vocabulary this/the campaign tried" appears at `/home/user/ollama/tests/service/browser.test.ts:14-15` and `guide:2495`.
- Name each case by its behavior, and drop the history the reader cannot check.

**O14 (required). Contract invariant 2 is false.**
- Invariant 2 says raw `typeof` and `instanceof` checks appear only inside compiled expressions. Host-side checks exist at `/home/user/browser/src/core/errors.ts:44`, `:55`, `/home/user/browser/src/core/BrowserPage.ts:423`, and `/home/user/browser/src/core/elements/BrowserElement.ts:312`, `:315`.
- Use `isString`, `isError`, and `isBrowserElementError`.

**O15 (required). U14's comments in `/home/user/ollama/tests/setupServer.ts` misstate the dependency.**
- `:621-626` says the target listing takes `{ timeout, signal }`; `:1084-1085` says it runs under the per-request timeout alone.
- `:1084` names the dependency's private `#syncContexts`.
- One explanation is repeated at `:621-632`, `:1078-1091`, `:1171-1179`, `:1213-1218`, `:1260-1267`, and `page.test.ts:16-24`.
- `:1281-1282` records a probe result ("measured on Node 24").
- Lines overrun the column at `:626`, `:1215`, and `page.test.ts:22`.
- The design gap: the helper passes `timeout` alone where the attempt's signal is in scope. Pass `{ timeout, signal: options.signal }` at `:1126` and `:1131` and thread the signal into `readOutcome` (`:1440-1446`). Then keep one statement of the bound on `boundPageAttempt` and delete the repeats.

**O16 (optional). `create()` takes no `signal`.**
- `BrowserPageOptions` (`/home/user/browser/src/core/types.ts:219-225`) has no signal, and neither does `page.network.start()`. That gap is what forces ollama's race-and-strand machinery.
- Let creation observe a `signal`; this is a capability expansion with a real consumer, so it is the owner's call.

**O17 (optional). Target ownership lives in class statics keyed by client.**
- `/home/user/browser/src/core/BrowserPage.ts:127-134`, `:1591`, `:1614`.
- An ESM copy and a CJS copy of core (both ship, `README.md:24`) each keep their own registry. A per-client owner that contexts and pages receive fits better. This was a recorded C3 ruling, so it is referred to the Orchestrator.

**O18 (optional). One concept, two words.**
- `native` (`/home/user/browser/src/core/types.ts:2086-2088`) versus "generic tools" (`guide:1567`, `:2567`).

### Checked and held
- **Guide numbers:**
  - 88 listing entries (89 lines minus the header), 55 under `imperative/`, 28 under `declarative/`: `/home/user/browser/tests/mirrors/wpt-webmcp-e6ba3d7abea7.txt`.
  - "Four of the five store tasks on their first attempt": `/home/user/ollama/tmp/probes/logs/v5/evidence.out` reports 4 passed and 1 expected fail, and each task has one attempt file. The search pin holds: `v5/search-1.json:101`, `:104`.
  - 256 predicted tokens: `/home/user/ollama/tests/service/browser.test.ts:32`.
- **UNRESOLVED:** "packed on 2026-09-30 from the tree this guide describes". v5 ran the tarball built from `43c111c` (ledger 312); the guide describes `9bbe834`. Running `git -C /home/user/browser diff --stat 43c111c 9bbe834 -- src` and seeing TSDoc-only changes would settle it.
- **Tagline:** `README.md:3-6` matches `guide:3-6` byte for byte.
- **Contract:** it has exactly 25 invariants.
- **Tool vocabulary:** each of the seven descriptions is at most 25 words and says what the tool does, and `look` and `read` say when to call them. The unknown-parameter and wrong-role refusals each name the next call.
- **Toolset events** `adopt`, `skip`, and `select` are one word each. The helper prefixes `boundBrowserText`, `validateBrowserToolArguments`, and `readBrowserToolString` are consistent with the existing `read*`/`require*` usage.
- **`it.skip`, `it.fails`, and `runIf` sites, each with a stated reason:**
  - The in-page `describe.runIf(isWebMCPDocument(document))` block (`/home/user/browser/tests/src/browser/factories.test.ts:275`): no shipping document registry.
  - The live registry skip (`/home/user/browser/tests/service/browser.test.ts:1197`): Chromium 141 answers `-32601`.
  - `COOPERATIVE_SIGTERM` guards (`/home/user/browser/tests/src/server/Browser.test.ts:1627`, `/home/user/browser/tests/setupServer.test.ts:551`): non-Windows only.
  - `/home/user/browser/tests/config.test.ts` (`:2306`, `:2448`, `:2453`, `:2461`) and `/home/user/browser/tests/policy.test.ts:718`: presence checks.
  - `/home/user/browser/tests/distribution.test.ts` (`:879`, `:969`, `:989`, `:1010`, `:1021`): registry and entry-kind gates.
  - ollama `it.fails` (`/home/user/ollama/tests/service/browser.test.ts:147`, reason in the header at `:13-15`) and the daemon skip at `:116`.
  - Referred to the objective lane: the `it.fails` pin also passes on any unrelated throw, including a daemon fault.

VERDICT: FAIL 1, 3, 6, 7, 8, O1, O2, O3, O4, O6, O7, O8, O9, O10, O11, O12, O13, O14, O15
