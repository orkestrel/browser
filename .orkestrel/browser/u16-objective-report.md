# U16 objective lane report (Astra `analyst`, read-only, 577 740 ms, verbatim)

Read-only review completed. No files changed, agents spawned, or tests run. Runtime results below come from the recorded runs. The browser source and tests match `9bbe834`; the later checkout changes are ledger-only.

**Rulings on the carried findings**

1. **BROKEN — blocking; fix action settlement.** An input-command reply does not establish that the form’s default action has finished starting navigation. [`BrowserToolset.ts:764`](/home/user/browser/src/core/BrowserToolset.ts:764) races the command against the navigation request; when the command wins, it immediately captures the view. A successful capture of the old document bypasses the navigation wait entirely.

   The brief’s witness needs correction: [`v4/click-1.json:189`](/home/user/ollama/tmp/probes/logs/v4/click-1.json:189) shows the cart correctly. The stale receipt is in [`c5/click-1.json:94`](/home/user/ollama/tmp/probes/logs/c5/click-1.json:94): the cart contains Cedar Tea Tray, but the click receipt still shows its product page.

   **Failing input:** click the product’s POST form button; the command resolves before its navigation request, and the server answers with a 303. **Smallest correct fix:** keep navigation observation active through completion of the input’s default action and receipt capture; route a late navigation into the existing bounded commit/load wait. Preserve dialog interruption, cancellation, and queue release. The precise browser ordering fence remains **UNRESOLVED** until demonstrated against that ordering; an arbitrary sleep would not establish it.

   Add a deterministic command-before-navigation regression and a real POST/303 case asserting the destination **in the receipt**. The current [service matcher](/home/user/browser/tests/setupService.ts:334) and [subsequent destination wait](/home/user/browser/tests/service/toolset.test.ts:159) permit a weaker result.

2. **CONFIRMED — record an upstream agent defect.** The attack that browser receipt rendering itself adds the outer JSON quoting failed: the installed [`@orkestrel/agent` implementation](/home/user/ollama/node_modules/@orkestrel/agent/dist/src/core/index.js:2190) calls `JSON.stringify` on successful values, including strings. The transcripts distinguish the raw receipt from the escaped model message.

   Fix this at the agent owner: pass strings through and serialize nonstrings. Do not compensate in browser receipts. Until then, the browser’s character limit bounds the receipt before agent serialization, not the expanded model-message representation.

3. **BROKEN — required; repair local parity coverage and the upstream parser.** [`guides.test.ts:248`](/home/user/browser/tests/guides.test.ts:248) derives implementing classes by stripping `Interface`. Consequently, `BrowserPageElementInterface` checks nonexistent `BrowserPageElement`, leaving the actual `BrowserElement` implementation outside that class comparison.

   **Failing input:** add an undocumented public method to `BrowserElement`; that comparison still sees an empty class surface. **Smallest fix:** explicitly map interfaces to their implementing classes, require mapped declarations to exist, and cover `BrowserElementInterface`’s documented surface rather than relying on the naming convention.

   Separately, [`@orkestrel/guide`’s `joinHead`](/home/user/browser/node_modules/@orkestrel/guide/dist/src/core/index.js:1242) recognizes a body opener only when the line ends with `{`. **Failing input:** an empty `extends … {}` interface followed by another declaration; parsing continues into the latter. Fix empty-body termination in the guide package, add that regression there, then consume the repair. The current [method-bijection claim](/home/user/browser/guides/browser.md:2351) exceeds the check.

4. **BROKEN — required; enforce the capture limit in both DOM reading paths.** [`BrowserDOMView.read`](/home/user/browser/src/browser/BrowserDOMView.ts:94) and [`BrowserDOMElement.read`](/home/user/browser/src/browser/elements/BrowserDOMElement.ts:137) pass unrestricted HTML directly into the reading constructor.

   **Failing input:** a document or element whose serialized capture exceeds `BROWSER_RESULT_LIMIT`; DOM reading succeeds where the corresponding CDP capture refuses. **Smallest fix:** share a DOM capture guard that applies the same serialized-character measurement and throws `BrowserResultLimitError` before parsing. Cover document and element reads, escaped-character boundary cases, and a successful smaller read after rejection. Do not inadvertently impose a transport-capture limit on every caller-created reading.

5. **CONFIRMED — record the bounded retry cost.** The attack that unrelated child-frame navigation can cause an unbounded retry or renew the deadline failed. The [element manager’s counter](/home/user/browser/src/core/elements/BrowserElementManager.ts:85) is broader than the failing capture’s frame, but [`BrowserToolset` retries only once within the same deadline](/home/user/browser/src/core/BrowserToolset.ts:869).

   This is an imprecise retry classification with a bounded cost, not proof that navigation caused the original rejection. No immediate repair is required.

6. **CONFIRMED — retain the capture semantics and record the offset reset.** The attack that a positive first offset silently skips uncaptured content failed. [`read`](/home/user/browser/src/core/BrowserToolset.ts:364) creates a fresh capture and starts it at zero when no usable retained capture exists; its footer reports that actual position.

   The final paging transcript demonstrates the distinction: an initial request for `4000` returns the first slice; continuing at its actual footer offset, `3998`, returns the token-containing slice. A positive offset is a continuation request against retained content, not permission to skip the beginning of a new capture.

7. **CONFIRMED — retain explicit lifecycle limits.** The attacks that failed setup publishes a usable held popup, or that direct construction acquires context ownership implicitly, failed against the [construction and discovery paths](/home/user/browser/src/core/BrowserPage.ts:260).

   The carried limitations remain: failed holder setup loses the opener relationship for later `sync()` recovery; discovery is retried through subsequent held-page construction; directly constructed pages neither hold targets nor enable discovery. The [guide](/home/user/browser/guides/browser.md:2347) records holder failure and direct construction. Record the discovery retry trigger beside them; do not describe it as automatic recovery.

8. **CONFIRMED — resolved; preserve the distinct error outcomes.** The attack that all creation failures should become `BROWSER_PAGE_CLOSED` failed. The [join path](/home/user/browser/src/core/BrowserContext.ts:403) distinguishes a page closed during creation from context shutdown, while the [attachment path](/home/user/browser/src/core/BrowserContext.ts:274) preserves the client’s attachment error.

   Keep `BROWSER_PAGE_CLOSED` for the closed-page case, `BROWSER_ERROR` for context shutdown, and the original CDP error for attachment failure. The fifth-review changes also retain joining an already-published `about:blank` page and reporting the error through the appropriate hook.

9. **UNRESOLVED — record the live-host limitation.** Chromium 141’s absence path is supported by the recorded service run and the [domain/start comparison](/home/user/browser/tests/service/browser.test.ts:1181). Mirrors and fixtures support conformance claims about this implementation; they do not prove interoperability with a shipping native registry.

   Settlement requires the service cases on a host exposing `WebMCP`, native in-page composition on a host exposing the required registry, and the separately identified WPT runner. Chrome version and flag references identify proposed hosts, not completed local runs. Broad claims about what *no shipping browser* exposes exceed the host evidence.

10. **CONFIRMED — record the mutation evidence’s limited specificity.** The attack that the [C3](/home/user/browser/.orkestrel/browser/c3-review-verdict.md) and [C4](/home/user/browser/.orkestrel/browser/c4-review-verdict.md) tables establish a uniquely diagnostic assertion for every edit failed. Their reported controls discriminate changed behavior but can overlap.

    Retain the narrower claim that the recorded mutations reddened the relevant controls. Do not infer unique fault identification or coverage of every equivalent implementation. I did not rerun those mutations.

11. **Record a preexisting ollama defect; do not require its repair in U14.** The supplied pristine-base comparison defeats attribution of the 3,000 ms integration timeout to this migration. The [U14 gate summary](/home/user/ollama/tmp/units/u14-gates.txt) records the red consumer suite and the base failure.

    Keep the defect assigned to ollama and keep its `npm test` status red in campaign reporting. The raw logs named in the brief are absent from the reviewed directory, so their detailed trace comparison is **UNRESOLVED** beyond the supplied baseline evidence; preserving those logs would settle that evidentiary gap.

**Findings outside the carried list**

- **O1 — BROKEN, required: navigation completion loses cancellation and timeout options.** [`navigate`](/home/user/browser/src/core/BrowserPage.ts:737) and [`reload`](/home/user/browser/src/core/BrowserPage.ts:760) call `#completeNavigation` without options, although its final [`location.href` evaluation](/home/user/browser/src/core/BrowserPage.ts:860) accepts them.

  **Failing input:** finish the navigation command and load event, hold the final evaluation, then abort the caller’s signal. That evaluation has no caller signal; a later reply can resolve the operation successfully. It also receives the default timeout instead of the caller’s timeout.

  **Smallest fix:** carry the call options through completion and check cancellation after the wait and completion read, following the existing [history-navigation path](/home/user/browser/src/core/BrowserPage.ts:784). Add regressions for both operations with cancellation during the final evaluation and a same-turn completion/abort race.

- **O2 — BROKEN, required: the expected-failure search test accepts unrelated failures.** [`service/browser.test.ts:147`](/home/user/ollama/tests/service/browser.test.ts:147) places the entire attempt, search assertions, and shared integrity assertions inside `it.fails`.

  **Failing input:** `attempt()` throws because toolset startup, navigation, or a provider request fails. The expected-failure test passes without observing the documented search failure. Broken shared receipt/reference assertions are inverted too.

  **Smallest fix:** establish attempt success, shared integrity, and the known failure signature outside the inverted assertion. Invert only the specific completion oracle. Prove both controls: completing the search reddens the pin, and an unrelated execution failure remains a real failure.

- **O3 — BROKEN, required: the guide overstates the search transcript’s uniformity.** The [guide](/home/user/browser/guides/browser.md:2495) says the model clicked the search box and ended empty “in every vocabulary the campaign tried.” [`v1/search-1.json`](/home/user/ollama/tmp/probes/logs/v1/search-1.json) instead records `look` followed by repeated `read` calls, with no search-box click.

  **Smallest fix:** attribute the click-then-empty sequence to the runs that show it. Describe earlier failures separately, or omit the universal claim. This is an evidence correction, independent of the subjective review.

**Attacked and held**

- **Context ownership and toolset integration — CONFIRMED within the recorded tests.** Attacks on duplicate publication, joining during creation, nested popup ordering, and publication after closure failed against the reservation/publication logic and the [context cases](/home/user/browser/tests/src/core/BrowserContext.test.ts:1142). The [toolset service cases](/home/user/browser/tests/service/toolset.test.ts:449) exercise popup selection and tab operations; the toolset’s [close handling](/home/user/browser/src/core/BrowserToolset.ts:1176) returns selection to a surviving opener or origin. This does not erase finding 7’s failed-setup limits.

- **DOM placement — CONFIRMED for the exercised fixtures.** The attacks that DOM receipts claim trusted input or that the fixture’s option controls remain unsupported failed against the [document service cases](/home/user/browser/tests/service/document.test.ts:92). These establish the exercised role/name and action behavior, not universal accessibility-tree equivalence. Finding 4 remains open.

- **Server lifecycle — CONFIRMED within the tested hosts.** Attacks on HTTP polling for launch readiness, lost ownership after transport loss, and destruction of merely attached processes failed against the [server lifecycle tests](/home/user/browser/tests/src/server/Browser.test.ts:732), including reconnection and attachment teardown. Actual Edge launcher pipe inheritance on Windows remains **UNRESOLVED**, as documented.

- **U14 migration — CONFIRMED.** The attack that a migrated evaluation still supplies the old numeric options argument failed at all six sites: [setup readiness](/home/user/ollama/tests/setupServer.ts:1131), [outcome reading](/home/user/ollama/tests/setupServer.ts:1446), and [page service calls](/home/user/ollama/tests/service/page.test.ts:143), [605](/home/user/ollama/tests/service/page.test.ts:605), [654](/home/user/ollama/tests/service/page.test.ts:654), [702](/home/user/ollama/tests/service/page.test.ts:702). The two guide files compare byte-identically. U14 records eight page-service passes; finding 11 prevents describing the entire consumer suite as green.

**Numerical evidence**

The [U13 report](/home/user/browser/.orkestrel/browser/u13-report.md) records, on 2026-09-30, formatting for 193 files; successful lint, type checks, and build; source **1,088 passed / 1 skipped**; policy **114/1**; config **172/1**; setup **122 passed**; browser setup **21 passed**; guides **199 passed**; conformance **69 passed**; release distribution **11/4**; service **48/1**; browser source **220/1**. Its source/test tree matches the requested review tree; these are recorded results, not new executions.

The final [v5 run](/home/user/ollama/tmp/probes/logs/v5/evidence.out:11) supports **four passes and one expected failure**, in **542.27 seconds**. The configured model, temperature **0**, **256** predicted tokens, and **8** turns are supported by the consumer setup. The transcripts support first-attempt completion of the asserted read, cart, form, and paging oracles. They do **not** establish four complete, correct natural-language answers: click ends partial, and paging retrieves the token but omits it from the answer. O2 limits the expected-failure result.

The three vendored mirror SHA-256 values match the guide. The protocol slice is **11,345 bytes**, matching its end-exclusive range. The WPT listing contains **88 entries**, including **55 imperative** and **28 declarative** entries; these are inventory counts, not executed WPT results. The unvendored whole-protocol digest cannot be independently recomputed from the local slice.

The documented numeric defaults and limits are implementation settings, not measured performance results: notably **2,500,000** serialized characters, **4,000** receipt characters before the footer, **5,000 ms** settlement with **1,000 ms** reserved for capture, and the **30,000 ms** wait cap. Finding 4 limits cross-placement enforcement; finding 2 limits interpretation of final model-message size. Example ports, coordinates, offsets, identifiers, and caller-selected limits are illustrative inputs. Node **22.12.0** is the declared minimum; U13 does not establish a minimum-version test matrix. Chrome/DevTools version references remain recorded research rather than a native-registry run.

**Remaining skips and expected failures**

| Location | Condition and reason |
|---|---|
| [Browser service:1197](/home/user/browser/tests/service/browser.test.ts:1197) | Live registry unavailable; skips only after `start()` reports absence. |
| [Browser factories:275](/home/user/browser/tests/src/browser/factories.test.ts:275) | Native document-registry composition requires `isWebMCPDocument(document)`. |
| [Setup server:551](/home/user/browser/tests/setupServer.test.ts:551), [server lifecycle:1627](/home/user/browser/tests/src/server/Browser.test.ts:1627) | `COOPERATIVE_SIGTERM`; excluded on Windows, where the tested cooperative signal behavior is unavailable. |
| [Browser distribution:969](/home/user/browser/tests/distribution.test.ts:969), 989, 1010 | Import, require, and browser execution apply only to compatible published faces; these explain the four release-run skips. |
| [Browser distribution:879](/home/user/browser/tests/distribution.test.ts:879), [1021](/home/user/browser/tests/distribution.test.ts:1021) | Ordinary-mode environmental skips for unavailable npm access or browser launch; release mode throws instead. |
| Both repositories’ `tests/config.test.ts`:2306, 2448, 2453, 2461 | Publication applicability and mutually conditional extractor-present/extractor-absent cases. U13’s config skip is the unavailable-extractor branch when the extractor exists. |
| [Browser policy:718](/home/user/browser/tests/policy.test.ts:718), [ollama policy:716](/home/user/ollama/tests/policy.test.ts:716) | The repository does not own the scaffold policy-term file. |
| [Ollama distribution:877](/home/user/ollama/tests/distribution.test.ts:877), 897 | Module/require applicability; [768](/home/user/ollama/tests/distribution.test.ts:768) additionally permits unavailable npm access only outside release mode. |
| [Ollama browser service:116](/home/user/ollama/tests/service/browser.test.ts:116) | Daemon/model readiness guard; setup also requires readiness. |
| [Ollama browser service:147](/home/user/ollama/tests/service/browser.test.ts:147) | The sole actual `it.fails`: search completion, defective as described in O2. |

There are no unconditional actual `it.skip` cases or remaining actual `it.fails` cases in the browser tree. Skip-marker strings in `setupService.test.ts` are inputs to guard tests, not skipped tests.

VERDICT: FAIL 1, 3, 4, O1, O2, O3