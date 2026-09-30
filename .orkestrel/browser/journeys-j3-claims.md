J3 implements exact-name matching and the generic view contract. Type-checking, core tests, formatting, lint, and policy pass. Browser validation remains blocked by the sandbox's loopback restriction.

The changes are:

| Location | Change |
| --- | --- |
| `src/core/helpers.ts:99` | Documents exact matching on the shared filter. |
| `src/core/helpers.ts:112` | Uses normalized, case-sensitive equality when `exact === true`; retains the existing case-insensitive substring branch otherwise. |
| `src/core/types.ts:2547` | Declares `BrowserViewInterface<E extends BrowserElementInterface = BrowserElementInterface>` and types `elements` with `E`. |
| `src/core/types.ts:3139` | Extends `BrowserViewInterface<BrowserPageElementInterface>` from `BrowserPageInterface`. |
| `tests/setup.ts:1597` | Supplies `Save`, `save`, `Save draft`, and `Save   draft`, their protocol fixture, and shared query cases carrying `exact`. |
| `tests/src/core/helpers.test.ts:63` | Tests the shared filter against the query cases. |
| `tests/src/core/elements/BrowserElementManager.test.ts:19` | Tests the real remote manager over the protocol fixture. |
| `tests/src/browser/elements/BrowserDOMElementManager.test.ts:381` | Adds the same cases over DOM buttons. Execution is blocked as reported below. |

The claims and their evidence are:

- Exact matching returns only `Save` for `{ role: 'button', name: 'Save', exact: true }`, and only `save` for the lowercase query. The remote manager and shared filter tests pass. The substring and case-folding mutations each fail the named remote-manager assertion.
- Whitespace normalizes on both sides: `  Save\n draft  ` matches both draft names under `exact`. Partial exact names return no matches. Omitted or false `exact` preserves the default results on the same input names. These cases pass in the core proofs.
- Both managers use this one filter: `src/core/elements/BrowserElementManager.ts:117` and `src/browser/elements/BrowserDOMElementManager.ts:168`. Neither manager needs an implementation edit. DOM runtime behavior remains unverified because Chromium's test runner cannot bind its listener.
- The generic contract and existing implementers and consumers compile under the root, core, server, and browser TypeScript projects. No consumer patch is required.

The mutation results use `npx vitest run --config vite.config.ts --project src:core tests/src/core/elements/BrowserElementManager.test.ts -t '<assertion>' --reporter=verbose`. Each mutation was restored; the final scoped run passes.

| Mutation | Breaking edit | Named assertion | Exit and counts | Artifacts |
| --- | --- | --- | --- | --- |
| `j3a` | Replaces exact equality with case-sensitive substring matching | `exact names reject substrings` | 1; 1 failed, 25 filtered out | `tmp/codex/j3-mutations/j3a.diff`, `tmp/codex/j3-mutations/j3a.log` |
| `j3b` | Folds both names to lowercase before exact equality | `exact names preserve case` | 1; 1 failed, 25 filtered out | `tmp/codex/j3-mutations/j3b.diff`, `tmp/codex/j3-mutations/j3b.log` |

Validation commands ran through `env -C /home/user/browser/tmp/worktrees/j3`. Formatting and lint target the changed files listed above. The scoped command is `npx vitest run --config vite.config.ts --project src:core tests/src/core/elements/BrowserElementManager.test.ts tests/src/core/helpers.test.ts`. Logged runs have matching `.err` files recording exit codes under `tmp/codex/`.

| Command | Exit | Counts and result | Log |
| --- | --- | --- | --- |
| Scoped command before the filter fix | 1 | 6 failed, 99 passed; failures name whole-name, case, and partial-name matching | `j3-before-corrected.log` |
| Scoped command after restoration | 0 | 105 passed across 2 files | `j3-final-scoped.log` |
| `npx oxfmt --check` over touched files | 0 | 6 files checked; all formatted | Tool output |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over touched files | 0 | No diagnostics | Tool output |
| `npm run check` | 0 | Root and all 3 source projects pass | `j3-check-fixed.log` |
| `npm run test:src:core` | 0 | 876 passed across 43 files | `j3-core.log` |
| `npm run test:src` | 1 | 0 tests executed; listener startup fails with `EPERM` | `j3-src.log` |
| `npm run test:src:browser` | 1 | 0 tests executed; listener startup fails with `EPERM` | `j3-browser.log` |
| `npm run test:setup` | 1 | 123 passed, 22 failed, 1 unhandled error across 5 files | `j3-setup.log` |
| `npm run test:policy` | 0 | 114 passed, 1 skipped | `j3-policy.log` |

The deviations and patches are:

- Browser and combined source validation expected executable suites; both instead report `listen EPERM: operation not permitted 127.0.0.1` before tests execute. The scoped DOM test command also fails at that boundary (`tmp/codex/j3-browser-before.log`). Browser proof and browser mutation runs are not complete; they require a host permitting loopback listeners.
- Setup validation expected a green suite. Its log reports 19 failures directly on loopback binding, plus a timeout and two downstream assertion failures, and one unhandled `EPERM`. No setup-server or global-test file was changed. A host run remains required.
- No `probe.prove` tool is registered, and user-scope MCP registration lies outside this unit's writable scope. No receipt was obtained. The evidence supplied is direct Vitest execution and the requested breaking mutations, not a `prove` receipt.
- The initial read command ran in the correct worktree but omitted the brief's required `env -C` prefix. Subsequent commands use that prefix.
- Shared-file patches: none. No unowned source or test file needs a change for the generic view. Guide changes remain with the design's J12 unit. No commit, stash, reset, checkout, or index-wide git command was issued.
