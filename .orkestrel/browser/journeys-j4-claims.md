# J4 claims

Implemented the toolset action boundary, replay hold, secret receipts, and journey step helpers. The core project passes 878 tests. The aggregate source and setup gates are blocked by the sandbox's loopback restriction. The service cases are written and untested by this unit.

## Changes

The implementation and its proofs are in these owned files.

| Location | Change |
| --- | --- |
| `src/core/types.ts:2803` | Adds `perform` and `hold` to `BrowserToolsetInterface`; imports `ToolCall`. No other interface members changed. |
| `src/core/BrowserToolset.ts:280` | Performs registered handlers and returns their correlated result and action. Manager handlers enter through `perform`; retained tool handles retain their original handler and thrown error. |
| `src/core/BrowserToolset.ts:341` | Acquires the hold through the action queue, observes cancellation, publishes its name, and reserves admission for its token. |
| `src/core/BrowserToolset.ts:408` | Refuses foreign action admission with `BROWSER_TOOLSET_BUSY` and the prescribed sentence. Observation tools and `wait` pass the reservation check. |
| `src/core/BrowserToolset.ts:649` | Validates `secret`, substitutes `a secret` in typing/selection receipts, and retains submission wording. |
| `src/core/BrowserToolset.ts:1021` | Captures the element's role, name, reference, and page frame before input dispatch. |
| `src/core/BrowserToolset.ts:1052` | Serializes actions, adopted tools, dialog answers, and hold acquisition; a dialog answer bypasses the pending input it must unblock. |
| `src/core/BrowserToolset.ts:1129` | Carries settlement stage and reason into the action. The wait timeout branch and dialog interruption branch assign their structured outcomes. |
| `src/core/BrowserHold.ts:16` | Implements the token, name, and idempotent release; reentrant destruction releases once. |
| `src/core/index.ts:34` | Exports `BrowserHold`. Existing star exports expose the helpers and types. |
| `src/core/helpers.ts:2387` | Resolves role and exact name through `elements.find`; refuses missing and ambiguous targets without reading reference or CSS evidence. |
| `src/core/helpers.ts:2419` | Builds calls by action, resolves tabs by URL and title, forwards caller/signal/secret, and stops on a failed outcome or incomplete navigation stage. Both helpers use the prescribed structural element-manager shape. |
| `tests/src/core/BrowserToolset.test.ts:75` | Proves action identity, target capture, secret output, timeout, hold admission/order/cancellation, and dialog continuation. The existing tab test also asserts action metadata and ambiguous semantic tab resolution. |
| `tests/src/core/BrowserHold.test.ts:6` | Proves token uniqueness and idempotent/reentrant release. |
| `tests/src/core/helpers.test.ts:69` | Proves resolution refusals, native argument construction, literal page-tool forwarding, secret forwarding, interrupted-call continuation, abort cleanup, and stopping before a suffix action. |
| `tests/setup.ts:2128` | Adds the service scenario data and inert combobox/child-frame markup. |
| `tests/service/toolset.test.ts:116` | Adds the `journey perform equality` service block. |

## Numbered claims

1. **Action identity and capture — design claim 1.** `perform` and manager execution use the same handlers. Each invocation owns a distinct signal-keyed action state, so identical concurrent calls return distinct actions. The emitted action is the returned object. A navigation replacing the document preserves the original target and records `loaded` with `formSubmissionPost`. See `tests/src/core/BrowserToolset.test.ts:110` and `tests/src/core/BrowserToolset.test.ts:148`; control `j4a` fails the target assertion.
2. **Hold admission and ordering — design claim 6.** A foreign native action, adopted action, or dialog answer is refused under a hold; its owner passes. Observations and `wait` pass the hold check. Acquisition waits for earlier adopted actions and dialog answers, and an aborted queued hold leaves the queue usable. Destruction emits one release. See `tests/src/core/BrowserToolset.test.ts:76`, `tests/src/core/BrowserToolset.test.ts:262`, `tests/src/core/BrowserToolset.test.ts:321`, and `tests/src/core/BrowserToolset.test.ts:374`; control `j4b` fails the adopted-action refusal assertion. `tests/src/core/helpers.test.ts:142` proves caller `finally` cleanup after an aborted held input and no suffix action.
3. **Dialog continuation — design claims 1 and 5.** An input with its protocol release withheld returns `interrupted` when the dialog opens. The hold owner's dialog answer runs, and the next input waits for the pending command. See `tests/src/core/BrowserToolset.test.ts:374` and `tests/src/core/helpers.test.ts:100`. The helper's non-`done` throw is preserved; its caller catches that error before issuing the dialog continuation.
4. **Timeout judgement — design claim 7.** A failed text wait keeps its successful tool-result receipt unchanged but returns action outcome `timeout`. The helper rejects with `s3: RECEIPT`, and the sequence sends no following click. See `tests/src/core/BrowserToolset.test.ts:240` and `tests/src/core/helpers.test.ts:280`.
5. **Secret receipt and forwarding — design claim 13's J4 portion.** The secret value reaches the input protocol, while the action omits `arguments.text`, carries `secret: true`, and uses the secret receipt wording. The submitted variants and the subsequent Enter contain no typed value in their action receipts. Direct manager calls use the same path. See `tests/src/core/BrowserToolset.test.ts:188` and `tests/src/core/helpers.test.ts:240`; control `j4c` fails the secret receipt assertion. As the design states, a page can separately display a value in its captured view; the action receipt is the receipt paragraph, not that view.
6. **Resolution and arguments — design claim 5's construction portion.** `click` and `type` receive the resolved `ref`; other native calls receive no synthesized `ref`; `switch` resolves `tab`; adopted arguments remain literal. Missing and duplicate targets refuse before input, without a CSS or stored-reference fallback. See `tests/src/core/helpers.test.ts:70`, `tests/src/core/helpers.test.ts:188`, `tests/src/core/helpers.test.ts:209`, and `tests/src/core/helpers.test.ts:240`; control `j4d` fails the wait receipt assertion. Exact matching inside each manager remains J3's implementation and proof.
7. **Settlement and service equality — design claims 1 and 5.** Existing core settlement, changed-view, dialog, queue, signal, and bound tests pass through the shared handler path in the 878-test core run. The service block compares full results and action stage/reason on independently reset fixtures, plus dialog and switch receipts. Its Chromium assertions remain unverified here.

## Mutation evidence

Each control was applied alone, its named test was collected and failed an assertion, and the source was restored. The restored selected run passed 4 tests, with 209 tests excluded by its name filter. Artifacts are under `tmp/codex/j4-mutations/`: `run.ts`, `j4a.txt` through `j4d.txt`, and the corresponding `.log` files. `run.ts refresh` updates restoration snapshots; `run.ts ID` applies a control; `run.ts restore` restores the saved source. The harness runs Vitest between application and restoration.

| Control | Breaking edit | Named assertion | Exit and count |
| --- | --- | --- | --- |
| `j4a` | Captures the target after input and receipt capture | `captures the target before input replaces the document`: expected the original target, received `undefined` | 1; 1 failed, 136 filtered |
| `j4b` | Exempts adopted tools from hold admission | `refuses an adopted action under a hold, lets observations and its owner pass, and releases on destroy`: expected busy refusal, received success | 1; 1 failed, 136 filtered |
| `j4c` | Echoes the typed text instead of `a secret` | `keeps secret text out of direct and structured receipts and action arguments`: receipt prefix mismatch | 1; 1 failed, 136 filtered |
| `j4d` | Adds `ref` to every step's arguments | `builds no ref for wait and stops a sequence at its unchanged timeout receipt`: received an invalid-parameter refusal instead of the timeout receipt | 1; 1 failed, 75 filtered |

## Validation

Commands ran through `env -C /home/user/browser/tmp/worktrees/j4`. The touched-file format and lint populations are the ten implementation/test files in the Changes table. Counts are measurements from the named runs, not service acceptance.

| Command | Exit | Result |
| --- | --- | --- |
| `npx oxfmt --check` over touched files | 0 | 10 files formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over touched files | 0 | No diagnostics |
| `npm run check` | 0 | Root and core/server/browser source checks pass, including service test types |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts tests/src/core/BrowserHold.test.ts tests/src/core/helpers.test.ts` | 0 | 214 passed at that run; subsequent helper/hold cases are included in the final core run |
| `npm run test:src:core` | 0 | 878 passed across 44 files; 36.16 s Vitest duration. `tmp/codex/j4-core-final.log` and `.err` |
| `npm run test:src` | 1 | No tests executed: browser project startup failed with `listen EPERM ... 127.0.0.1`. `tmp/codex/j4-src.log` and `.err` |
| `npm run test:setup` | 1 | 123 passed, 22 failed, 1 unhandled error across 5 files. Loopback fixture setup fails with `EPERM`; dependent cleanup expectations and one listening-server timeout also fail. |
| `npm run test:policy` | 0 | 114 passed, 1 existing skip, 115 collected |
| Selected restored mutation tests | 0 | 4 passed, 209 filtered, 2 files |
| Service project | Not run | The brief assigns Chromium execution to the Orchestrator |

The corrected recorder assertion in the helper suite projects the actual argument record from the callback's argument/context pair. Its earlier core run reported 1 failed and 876 passed; the final run reports 878 passed after that correction and the additional admitted-dialog hold proof.

## Service handoff

Run the following after integrating J3 and building the browser/core bundles in a host that permits Chromium and loopback:

```text
npx vitest run --config vite.config.ts --project service tests/service/toolset.test.ts -t 'journey perform equality'
```

The block contains the native equality matrix for click, type, submitted form, delayed child submission, press, navigate, and wait; editable-combobox equality and resulting value; interrupted click/dialog/pending-input continuation; URL/title switch resolution and receipt equality; and a semantic DOM-placement click in a same-origin child frame. The DOM case hard-requires the built bundle and uses the existing document fixture. No service assertion was executed by J4.

## Deviations and integration notes

- **Environment gates:** `test:src` and `test:setup` cannot pass in this sandbox because loopback binds are refused. No port, browser, permission, or configuration workaround was attempted. The prescribed core-only project supplies local implementation evidence; it does not replace host acceptance.
- **Mutation runner:** The first launcher-based mutation attempt failed before test execution because `spawnSync env` returned `EPERM`. Its source was restored in `finally`. The harness then ran each control through the ordinary command tool; the table reports those assertion failures, not the failed launcher attempt. The runner is retained as a preparation/restoration script.
- **Formal instrument:** No `prove` MCP tool is registered in the available tool inventory. Registering one outside this checkout is outside the unit's owned paths and writable roots. There is no formal `prove` receipt; the named mutation assertions are the evidence supplied instead.
- **Helper options:** The design's locator signature supplies no step id while its refusal sentences require one. `locateBrowserTarget` accepts `options.id` and defaults it to `s1`; `performBrowserStep` supplies its actual id. J5 must supply the replay step id when calling the locator directly. `performBrowserStep` accepts literal substituted arguments, `options.caller`, and `options.secret`; the last forwards `secret: true` for `type`. Its structural view contract does not depend on J3's generic interface edit.
- **Interrupted helper contract:** The prescription requires both a throw on every non-`done` outcome and a dialog continuation after interruption. This implementation preserves the throw, with continuation proven after the caller catches it. A generated module that blindly awaits the interrupted helper and has no catch stops before its dialog step; J7 must account for the prescribed throw when emitting that sequence. No compiler file was changed here.
- **Receipt projection:** `BrowserAction.receipt` is the handler's receipt paragraph, as J1's type documentation states; `result.value` retains the full receipt and view. Interrupted and refused receipts retain their boundary text. The service equality matrix compares the full tool results as well as structured stage/reason.
- **Review and documentation:** The unit is a sole-writer implementation and makes no acceptance ruling. Independent campaign review, J3's exact-match manager proof, J12's guide parity, and host service gates remain with their owning units/Orchestrator. No subagent was spawned.
- **Scope:** No additional source file beyond the named ownership list was needed. Imports supporting the journey service block were added to its existing file. No commit, stash, reset, checkout, index-wide git command, or scaffold-owned edit was performed.
