# J2 claims

The journey leaves are implemented. The scoped run passes 176 tests, and the core project passes 947 tests. Each requested mutation fails its named assertion. The combined source suite and setup suite remain blocked by the host's loopback restriction. The run renderer takes an optional final-view argument because the declared run contains no view; D1 records this interpretation for integration.

The source and test changes are:

| Location | Change |
| --- | --- |
| `src/core/validators.ts:188` | Asserts the journey format and invariants 1–7, with named invariant diagnostics and the separate format error code. |
| `src/core/validators.ts:35` | Supplies total binding, target, and tab guards; parameter and step validators begin at lines 83 and 110. |
| `src/core/validators.ts:265` | Asserts edit structures independently of position and final parameter bindings. |
| `src/core/validators.ts:317` | Validates persisted run fields, the embedded journey, the executed prefix, completion, and secret exclusions. |
| `src/core/parsers.ts:674` | Adds `parseBrowserJourney`, `parseBrowserJourneyEdit`, and `parseBrowserRun`, returning the input or `undefined` through the installed `attempt` boundary. |
| `src/core/helpers.ts:2391` | Collects native parameter bindings while preserving page arguments as literal JSON. |
| `src/core/helpers.ts:2418` | Applies pure, atomic edit batches with stable ids, argument merging, final binding checks, parameter pruning, and indexed refusal clauses. |
| `src/core/helpers.ts:2497` | Resolves literal and parameter string arguments. |
| `src/core/helpers.ts:2518` | Renders the journey listing and action templates. |
| `src/core/helpers.ts:2572` | Derives triggers by action; secret-name derivation begins at line 2601 and run-id generation at line 2625. |
| `src/core/helpers.ts:2637` | Strips directives outside quoted text from receipts; run rendering begins at line 2669. |
| `src/core/index.ts:38` | Exports the validator module. |
| `tests/setup.ts:2725` | Supplies the journey/run fences and the action, invalid-journey, and edit-refusal matrices. |
| `tests/src/core/parsers.test.ts:345` | Covers JSON round trips, malformed inputs, literal page arguments, and hostile property reads. |
| `tests/src/core/validators.test.ts:20` | Covers each invariant, formats, secrets, action shapes, run fields, and the validator leaves. Boundary tests begin at line 150. |
| `tests/src/core/helpers.test.ts:963` | Covers edits, atomic refusals, listings, triggers, bindings, secret names, and ids. Run-render tests begin at line 1115. |

The numbered claims are the review surface:

1. Journey validation rejects reserved or overlong names, duplicate or malformed ids, invalid counters, incompatible native targets/tabs, undeclared or unused parameters, secret defaults, non-JSON values, and observation/journey tools used as actions. Unknown formats carry `BROWSER_JOURNEY_FORMAT`; the other journey failures carry `BROWSER_JOURNEY_INVALID` and name their invariant. The invalid-case matrix exercises every invariant that has a refusal; parser tests prove the positive round trip.
2. Only native string arguments and target names bind parameters. Page-tool `ref`, `tab`, and `{ parameter: ... }` values remain literal JSON. A secret binds only `type.text`; mutation `j2c` detects acceptance of `wait.text`.
3. Edits apply in order to copied collections. `add` uses the persisted `next` counter, `remove` never rewinds it, `update.arguments` merges by key, and target/tab replacements undergo the native-action checks. Parameter declarations and bindings may appear in either order within a batch. The final candidate drops parameters the batch unbound, but refuses an unbound declaration. Failed batches leave the input unchanged. Errors carry a one-based `context.index` and a `context.reason`, with no appended directive or final period. Mutations `j2a` and `j2b` attack id reuse and unbound declarations.
4. The journey listing matches the design fence byte for byte. Tests cover every action template, parameter omission, secret marks, bound target names, submit, and reference omission. The run listing matches the fence when the final view is supplied separately. Complete, stopped, and aborted headings, the blank line before the view, and directive stripping are tested. Quoted `; call ...` text remains literal. Mutation `j2d` detects a retained directive.
5. Trigger derivation uses target names for click/type, the key for press, URL for navigate, text for wait, tab title for switch, accept/dismiss for dialog, and the tool name for page tools. Secret-name derivation handles words, existing camel case, acronym boundaries, invalid names, and occupied names. Run ids contain an ISO timestamp with colons replaced by hyphens and a cryptographic four-hex suffix.
6. Run parsing validates the declared JSON fields, step ids/actions against a journey prefix, completion against step outcomes, and the optional navigation fields. It refuses secret inputs, output, captures, and retained secret `type.text`. It does not inspect receipt strings for arbitrary values a page might republish; the design states that boundary.

The installed capability reuse is:

| Local requirement | Installed capability | Decision |
| --- | --- | --- |
| JSON representation, cycles, and non-finite values | `@orkestrel/contract` `isJSONValue`, with `JSONValue` already used by J1 | Reuse the installed guard; add journey-specific invariants. |
| Primitive and record narrowing | `isRecord`, `isString`, `isBoolean`, `isFiniteNumber`, `isArray`, `parseEnum` | Import directly. |
| Parser and hostile-getter boundaries | `attempt` | Import directly; no local generic exception wrapper. |
| Journey names, parameter names, native actions, and format | J1 constants | Reuse; return the constant rename as P1. |

The mutation results are:

| Mutation | Breaking edit | Named assertion | Exit and counts | Artifacts |
| --- | --- | --- | --- | --- |
| `j2a` | Adds a step with `next - 1`, reusing the removed highest id | `never reuses an id after removal` | 1; 1 failed, 112 filtered out | `tmp/codex/j2-mutations/j2a.diff`, `.log`, `.err` |
| `j2b` | Returns a lone declaration without final binding checks or pruning | `refuses a lone unbound declare` | 1; 1 failed, 112 filtered out | `tmp/codex/j2-mutations/j2b.diff`, `.log`, `.err` |
| `j2c` | Admits a secret binding at `wait.text` | `refuses a secret bound to wait.text` | 1; 1 failed, 32 filtered out | `tmp/codex/j2-mutations/j2c.diff`, `.log`, `.err` |
| `j2d` | Disables the directive-removal branch | `strips a directive from a run step line` | 1; 1 failed, 112 filtered out | `tmp/codex/j2-mutations/j2d.diff`, `.log`, `.err` |

Each successful mutation experiment used `npx vitest run --config vite.config.ts --project src:core <test-file> -t '<assertion>'`, through the scaffold launcher. `j2a` used the verbose reporter; the others used the dot reporter. `prepare.ts` applies and restores the recorded edits. Every source mutation was restored before final validation. The final scoped run collects and passes all mutation assertions.

Validation ran through `env -C /home/user/browser/tmp/worktrees/j2`. Format and lint target `src/core/{parsers,validators,helpers,index}.ts`, `tests/src/core/{parsers,validators,helpers}.test.ts`, and `tests/setup.ts`. The scoped command names those test files under `--project src:core`.

| Command | Exit | Counts and result | Evidence |
| --- | --- | --- | --- |
| `npx oxfmt --check` over touched files | 0 | 8 files; all formatted | Tool output |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over touched files | 0 | No diagnostics | Tool output |
| Scoped Vitest run after mutation restoration | 0 | 176 passed across 3 files | `tmp/codex/j2-scoped.log`, `.err` |
| `npm run check` | 0 | Root and core, server, and browser TypeScript projects pass | `tmp/codex/j2-check.log`, `.err` |
| `npm run test:src` | 1 | No tests execute; browser listener startup raises `EPERM` | `tmp/codex/j2-src.log`, `.err` |
| `npm run test:src:core` | 0 | 947 passed across 44 files | `tmp/codex/j2-core.log`, `.err` |
| `npm run test:setup` | 1 | 123 passed, 22 failed across 5 files; 1 unhandled error | `tmp/codex/j2-setup.log`, `.err` |
| `npm run test:policy` | 0 | 114 passed, 1 skipped | `tmp/codex/j2-policy.log`, `.err` |
| `git apply --check tmp/units/journeys/j2-format-version.patch` | 0 | P1 applies to the final unit tree | Tool output |

The deviations and scope notes are:

- **D1, final view:** § 7 expects the final view in `renderBrowserRun(run)`, but `BrowserRun` at `src/core/types.ts:1924` has no view member. Its `output` explicitly means console/error events, and `BrowserRunStep.result` means the receipt or refusal. The renderer therefore accepts `renderBrowserRun(run, view?)`; it emits the complete design fence when J8 supplies the final view, and emits only the heading and step lines when the argument is absent. No run-type change was made. This is an integration decision for the Orchestrator, not evidence that a final view can be reconstructed from the declared run alone.
- **D2, run-id spelling:** The § 2 directory illustration replaces the millisecond dot with a hyphen, while § 4 and the declared type documentation say to replace colons only. Generation and run validation follow the textual contract: `2026-09-30T14-03-12.481Z-7f3a`. The directory illustration needs alignment by its owner.
- **D3, constant naming:** The error code remains `BROWSER_JOURNEY_FORMAT`. P1 renames the numeric constant to `BROWSER_JOURNEY_FORMAT_VERSION` and updates every constant reference found in source, tests, and the browser guide population. Error-code literals and error-code documentation retain their spelling. The patch is report-only, as prescribed.
- **D4, scope:** `src/core/validators.ts` and its mirrored test did not exist and were created within the named ownership. `src/core/index.ts:38` is the additional owned export of these named symbols under the brief's export exception. No class or public type file was edited. Neither J4 helper was added.
- **D5, host validation:** The combined source suite fails at `listen EPERM: operation not permitted 127.0.0.1`. Setup has 19 direct listener failures, a dependent timeout, two downstream assertion failures, and one unhandled listener error. These match the failure classes J3 reported. The core-only run passes; browser, server, and complete setup execution need a host that permits loopback listeners. No unowned test or setup-server file was changed to bypass the restriction.
- **D6, proof instrument:** No `probe.prove` tool is registered in this session. Registering a user-scope server lies outside the unit's writable scope. No probe receipt was obtained; the report offers direct Vitest evidence and the requested mutations, not a `prove` receipt.
- **D7, command prefix:** The initial read ran in the correct worktree but omitted the required `env -C` prefix. Subsequent shell commands use it. No commit, stash, reset, checkout, or index-wide git command was issued.
- **D8, interpretation details:** Edit indices are one-based, matching § 7's user-facing `Edit 2` example. A bound nonsecret string without a default renders its parameter name as the quoted display value, followed by `as NAME`. Aborting after completed steps names the next pending step; aborting before any step names the first step. These choices are implemented and recorded because the design does not give those complete examples.
- **D9, acceptance:** This is the sole writer's unit report. Independent campaign review and acceptance remain with the Orchestrator; no subagent or alternate writer was launched. Guide parity and the journey-tool listing join remain with J12 and J8 respectively.

P1 is the exact shared-file patch at `tmp/units/journeys/j2-format-version.patch`. It changes the constant declaration in `src/core/constants.ts`, its format-member documentation in `src/core/types.ts`, and the import and comparisons in `src/core/validators.ts`. Apply it after this unit; it passed `git apply --check`. No other shared-file patch is required by this implementation.
