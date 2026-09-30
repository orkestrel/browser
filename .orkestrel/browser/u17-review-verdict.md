# U17 review verdict and rulings

Objective review by the Astra `analyst` (read-only, 394 364 ms; report `tmp/codex/u17-review-answer.md`) over `tmp/units/u17-claims.md` (14 claims) and `tmp/units/u17-diff.patch` with the three mirrors read by digest.

Verdict: FAIL 4, 7, 8, 10, 11; outside the claims: none. Confirmed: acceptance 1, 2, 3, 5, 6; R1 (the digests recomputed independently, the end-exclusive cut reproduced from the whole protocol file), R4 (the existing `.prettierignore` excludes `tests/mirrors/`), R5, R6; the mark edge cases by inspection; the reference-numbering change ruled correct for U11b and U12.

Rulings, each carried by the fix brief `tmp/units/u17-fix-brief.md` (P1–P5):

- Claim 4 (BROKEN): the mapping fixture sets both hints `true`, so a swapped destination or an inverted `untrusted` passes. P1 adds opposing, omitted, and `untrustedContent: true` cases.
- Claim 7 (BROKEN): the export scan is a regular expression over declaration syntax and misses `export { X as Y }` and a comment between `export` and the declaration. P2 enumerates exports through the TypeScript compiler API with controls.
- Claim 8 (UNRESOLVED): the WPT directories are not established at the pinned revision (the GitHub API is gated for that repository in this session; `add_repo` requested). P3 cites the listing if the Orchestrator obtains it, else records the directories as named from the specification's metadata with the listing as the closer.
- Claim 10 (BROKEN): the mapping and skip rows' `model` values are never read and the debugging fixture derives its input from `row.expected`. P4 makes each row carry consumed input and an observed model compared through `readConformanceDrift`.
- Claim 11 (BROKEN): decision 27 rules the conformance process, not the provider charset and bound; the brief's R3 repeated the misattribution. P5 cites the restriction beside `BROWSER_TOOL_NAME_PATTERN`.
- The mutation-record limits the review names (the marks record not isolated, the changed-byte mutation not mutating validation, the parser census injected into the setup callback, the single-name fixture) are accepted as bounded evidence; direct inspection established the live parser census and the metadata read.
