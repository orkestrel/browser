# U16 review verdict

Two read-only lanes over `/home/user/browser` at `9bbe834` and `/home/user/ollama` at `9f46eac` with eleven carried findings: the objective lane (Astra `analyst`, `u16-objective-report.md`): `VERDICT: FAIL 1, 3, 4, O1, O2, O3`; the subjective lane (Opus `reviewer`, `u16-subjective-report.md`): `VERDICT: FAIL 1, 3, 6, 7, 8, O1–O4, O6–O15`.

## Rulings on the carried findings

1. Blocking, fixed in C6 S1: an action's settle waits for the navigation a form submit starts (a one-shot `submit` listener in the isolated world read after the input settles; the existing bounded navigation wait), with a deterministic regression, a POST-and-303 service case asserting the destination in the receipt, a `preventDefault` control, and the matcher tightened. The witness is `logs/c5/click-1.json:94`, not v4.
2. Recorded for the fleet: `@orkestrel/agent` serializes a string tool result through `JSON.stringify`; fixed at the agent owner, never compensated in the receipts; the store proof reruns after that fix before the evidence paragraph's escaped-encoding measurement is restated.
3. Fixed in C6 S5 (the class `BrowserElement` becomes `BrowserPageElement`, so the parity convention holds and `BrowserElementInterface` gets its own group) and recorded for the fleet (`@orkestrel/guide` reads an empty `extends … {}` body through to the next declaration; `BrowserDOMElementInterface` keeps no table until that fix, stated in one guide sentence).
4. Fixed in C6 S7: the DOM reading paths enforce `BROWSER_RESULT_LIMIT` through one shared guard.
5. Resolved: the child-frame retry is one bounded capture inside the same deadline (recorded).
6. Recorded in the guide (G1): a `read` whose offset no earlier read of the same document named restarts at 0 and its footer shows the returned range.
7. Recorded in the guide (G1): a failed or re-enabled discovery request is sent again by the next context-constructed page on that connection, never automatically.
8. Fixed in C6 S2: the context's closed refusals carry `BROWSER_CONTEXT_CLOSED`; `BROWSER_PAGE_CLOSED` and the client's attachment error stay distinct.
9. Recorded limit, worded within the host evidence (G1): Chromium 141 exposes no `WebMCP` domain; the guide claims conformance against the mirrors, not interoperability with a shipping registry.
10. Resolved: the mutation tables claim discrimination, never unique identification.
11. Recorded for the ollama repository: `tests/src/core/integration.test.ts:134` times out on the pristine base too; the consumer's `npm test` stays red in the campaign's reporting and the wave's ollama gate is the owner's call.

## Findings outside the carried list

- Objective O1 (navigation completion drops the call options): C6 S8. Objective O2 (the search pin inverts every assertion): U14b. Objective O3 (the guide overstates the search transcript's uniformity): G1.
- Subjective O1, O2, O3 (the evidence paragraph, the prompt description, the Surface fence's seeded first turn), O6 (the receipts table), O8, O9, O10 (the error-code table), O12 (the writing sweeps), O13's guide part, and the D4 sentence: G1. Subjective O4, O5, O7, O12's constants remark, O13's test titles, O11, O14: C6 S4, S9, S6, S3. Subjective O15: U14b.
- Optional, recorded and not done: O16 (`create()` takes no signal), O17 (target ownership in class statics keyed by client; an ESM and a CJS copy each keep a registry), O18 (`native` versus "generic tools").
- The store proof reruns (U15 v6) after C6's tarball, because S4 changes model-facing text.
