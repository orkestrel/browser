# Verify verdict: the proposal's relation to WebMCP

Seam: the "Relation to WebMCP" section, U17 `conformance`, and the sentences that reference them in `PROPOSAL.md`, written after the owner's ruling of 2026-09-29. One verify pass, three blind refuters in the workflow `webmcp-alignment-verify`; the lane reports are in `webmcp-alignment-findings.md` and the three reader reports behind the section are `webmcp-read-bridge.md`, `webmcp-read-surface.md`, and `webmcp-read-rules.md`. The routing rule the owner set the same day (no subagent on the session model) postdates this workflow's launch; the owner let it finish.

## Lanes

The following table lists the lanes.

| Lens | Verdict | Findings |
| --- | --- | --- |
| Spec and source accuracy | FAIL | 1 blocking, 7 required, 6 optional |
| Fleet rules and precedent | FAIL | 2 blocking, 6 required, 4 optional |
| Internal coherence and intent | FAIL | 2 blocking, 8 required, 4 optional |

## Reproduced

The following readings were taken before acting on the blocking finding (curl, 2026-09-29): `webmcp/META.yml` (90 bytes), `webmcp/idlharness.https.window.js` (212 bytes, `idl_test(['webmcp'], ['html', 'dom'])`), and `interfaces/webmcp.idl` (2 136 bytes, `ontoolchange` alone, three hints, `executeTool` taking `any`) from `web-platform-tests/wpt` at `master`; `index.bs` (86 547 bytes) from `webmachinelearning/webmcp` at `main`, whose line 20 reads `Test Suite: https://wpt.fyi/results/webmcp`, whose lines 622 and 623 declare `ontoolactivated` and `ontoolcancel`, whose line 1118 declares `debugging`, and whose line 158 carries the 1-to-128 name rule. The other findings are confirmed against the proposal's own text.

## Rulings

The following table rules on each finding; ids are the lane's (`acc`, `rul`, `coh`).

| Finding | Ruling | Carried in |
| --- | --- | --- |
| acc-1 (blocking): the specification names a WPT suite | Accepted; the "no test suite" sentence replaced by the three readings; webref's IDL vendored as the idlharness mirror; running WPT's cases against the double is a declared gap with its closer | "Relation to WebMCP", Evidence, U17 rows 3 and 8, Limits |
| rul-1, coh-1 (blocking): `tests/src/browser/conformance.test.ts` fails the mirror rule | Accepted; the composition cases live in `tests/src/browser/factories.test.ts`; U9's type test moves to `tests/src/browser/types.test.ts` | U17 Owns, U9 |
| rul-2, coh-2, acc-2 (blocking, required): seven against five | Accepted; the DOM placement publishes five | U17 row 5 |
| acc-3, rul-5, coh-13: `autosubmit` mapped to nothing | Accepted; retained on `BrowserToolAnnotation`, marked nowhere | U17 row 4 |
| acc-4, coh-14: the name gap omits the 64 bound and cites no provider source | Accepted; the gap names both; the provider documents are U7's to read and cite | Adoption policy, U17 row 4, Limits |
| acc-5, rul-6, coh-4: `stackTrace` and `RemovedTool` have no ruling path | Accepted; domain rows get the ruled table; `stackTrace` excluded; `parseBrowserRemoval` added to U6 | U17 row 2, U6 |
| acc-6, rul-4, coh-8: the declarative row's proof pointed at U4 and U10 | Accepted; the proof is U17 rows 4 and 6, and U17 edits the two element managers after U4 and U10 | Adapter table, U17 Owns |
| acc-7, rul-10, coh-11: the mcp precedent was misdescribed | Accepted; rulings follow the parity table with a source, closers follow the gaps entries | "Stay aligned", U12 |
| acc-8, coh-3: a `Navigator` registry would skip silently | Accepted; the absence path asserts both locations | U17 row 5 |
| rul-3, coh-7: U10 needs the double U17 owned | Accepted; U10 owns `tests/fixtures/modelContext.ts`; U17 consumes it | U10 Owns |
| rul-7, acc-10: the response-precedes-events sentence sits on the return | Accepted | U17 row 2 |
| rul-8: a module-load digest proof steers toward module replacement | Accepted; the reader throws against a scratch copy, the setup module pins at top level | U17 row 1 |
| coh-5: the name rule is prose, not IDL | Accepted; `index.bs` is vendored whole and the row reads the paragraph | "Stay aligned", U17 row 3 |
| coh-6: U17's place in the order was unstated | Accepted | Units preamble, U17 |
| coh-9: no refresh trigger, source, or cut method | Accepted; the ritual names the trigger, the three raw sources, the commit token, the byte-range cut, and the record | "Stay aligned" |
| coh-10: no unit records the mirror revisions in the guide | Accepted | U12 Owns and acceptance 4 |
| acc-9, acc-11, acc-12, acc-13, acc-14, coh-12, rul-9, rul-11, rul-12 (optional) | Accepted as worded fixes: the bridge's reading date, "one per side of the browser boundary", commit-named mirrors, the composition case registering `readOnlyHint` alone, "code points from ASCII alphanumerics", the reuse note on the copied double, "no exported entity", the byte-range cut | Throughout |

## Held

The lanes held, and the text keeps: the fixed conformance home and Node project; the boundary-stub exemption for composing mcp's real bridge over this package's double; the `runIf` mechanism citation; the creation gate on the `[tool=NAME]` mark; the authorized development edge; the absence of `WebMCP` or `ModelContext` in any exported name; the wire spelling of `readOnly` and `untrustedContent`; the domain inventory; the engine and dependency order; the prose against the writing rules.
