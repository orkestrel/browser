# J1 claims: the journeys contract

Tree: branch `ccr-d15a48b1-yyyll6` at `6d8e8ed`, uncommitted. Touched: `src/core/types.ts`, `src/core/constants.ts`, `src/server/types.ts`. Unchanged: `src/core/errors.ts`, `src/core/index.ts` (see Deviations D2 and D3).

Diffstat (`git diff --numstat`): `src/core/constants.ts` +176 −2; `src/core/types.ts` +567 −4; `src/server/types.ts` +49 −0; 792 insertions, 6 deletions.

## Declarations

`src/core/types.ts`, section `// === Browser journeys` at :1580, placed immediately before `// === Browser codegen` so J7's retirement leaves it in that position:

| Design § | Declaration | Line |
| --- | --- | --- |
| 2 | `BrowserJSONValue` | not declared; `JSONValue` from `@orkestrel/contract` used in its place (D1) |
| 2 | `BrowserJourneyBinding` | src/core/types.ts:1583 |
| 2 | `BrowserJourneyParameter` | src/core/types.ts:1595 |
| 2 | `BrowserJourneyTarget` | src/core/types.ts:1610 |
| 2 | `BrowserJourneyTab` | src/core/types.ts:1623 |
| 2 | `BrowserJourneyStepInput` | src/core/types.ts:1642 |
| 2 | `BrowserJourneyStep` | src/core/types.ts:1654 |
| 2 | `BrowserJourney` | src/core/types.ts:1669 |
| 2 | `BrowserJourneyRevision` | src/core/types.ts:1682 |
| 2 | `BrowserJourneyEdit` | src/core/types.ts:1700 |
| 2 | `BrowserJourneyEditRequest` | src/core/types.ts:1725 |
| 3 | `BrowserRecorderEventMap` | src/core/types.ts:1749 |
| 3 | `BrowserRecorderInterface` | src/core/types.ts:1763 |
| 3 | `BrowserRecorderOptions` | src/core/types.ts:1792 |
| 4 | `BrowserAction` | src/core/types.ts:1813 |
| 4 | `BrowserStepOutcome` | src/core/types.ts:1840 |
| 4 | `BrowserRunOutcome` | src/core/types.ts:1850 |
| 4 | `BrowserToolsetResult` | src/core/types.ts:1860 |
| 4 | `BrowserHoldInterface` | src/core/types.ts:1872 |
| 4 | `BrowserRunStep` | src/core/types.ts:1895 |
| 4 | `BrowserRun` | src/core/types.ts:1924 |
| 4 | `BrowserReplayOptions` | src/core/types.ts:1946 |
| 4 | `BrowserReplayEventMap` | src/core/types.ts:1959 |
| 4 | `BrowserReplayInterface` | src/core/types.ts:1967 |
| 7 | `BrowserStoreOptions` | src/core/types.ts:1983 |
| 7 | `BrowserStoreFault` | src/core/types.ts:1994 |
| 7 | `BrowserStorePage<T>` | src/core/types.ts:2007 |
| 7 | `BrowserJourneyStoreInterface` | src/core/types.ts:2014 |
| 7 | `BrowserRunSlot` | src/core/types.ts:2054 |
| 7 | `BrowserRunStoreInterface` | src/core/types.ts:2060 |
| 7 | `BrowserJourneyOptions` | src/core/types.ts:2088 |
| 7 | `BrowserJourneyToolsetInterface` | src/core/types.ts:2101 |
| 6 | `BrowserCodegenScript` (`{ source, gaps }`), in `// === Browser codegen` after `BrowserCodegenLanguage` | src/core/types.ts:2155 |

Additive members on existing declarations:

| Design § | Change | Line |
| --- | --- | --- |
| 4 | `BrowserElementQuery.exact?: boolean`, with `@remarks` | src/core/types.ts:2325, member :2330 |
| 4 | `BrowserToolName` gains `record`, `save`, `journeys`, `edit`, `replay`; summary names them | src/core/types.ts:2670, members :2681–2685 |
| 4 | `BrowserToolsetEventMap` gains `action`, `hold`, `release`, with `@remarks` rows | src/core/types.ts:2735, members :2739–2741 |
| 4, 7 | `BrowserToolsetOptions.journeys?: BrowserJourneyOptions`, with a `@remarks` row | src/core/types.ts:2766, member :2776 |

`src/server/types.ts`:

| Design § | Declaration | Line |
| --- | --- | --- |
| 7 | `FileBrowserStoreOptions`, under `// === Browser journey stores` (:324) | src/server/types.ts:334 |
| 8 | `BrowserMCPServerOptions`, under `// === Browser MCP server` (:339) | src/server/types.ts:352 |
| 8 | `BrowserMCPServerInterface` | src/server/types.ts:360 |

Every summary opens on a third-person verb and is the design's sentence where the design gives one; every `@remarks` carries the member notes the design writes; every interface method carries a one-line TSDoc drawn from the design's prose. `types.ts` imports `JSONValue` from `@orkestrel/contract` and `ToolResult` from `@orkestrel/tool`, both declared runtime dependencies.

Deferred to their units, untouched here: `perform` and `hold` on `BrowserToolsetInterface` (J4), the generic `BrowserViewInterface` and `BrowserPageInterface`'s extension (J3), `BrowserCodegenInterface extends BrowserRecorderInterface` (J6), and `BrowserCodegenInterface`, `BrowserCodegenOptions`, `BrowserCodegenAction`, `BrowserCodegenEventMap`, and `BrowserCodegenScriptOptions` (J6, J7).

## Constants

`src/core/constants.ts`:

| Constant | Value | Line |
| --- | --- | --- |
| `BROWSER_TOOL_COPY.type` gains `secret` | `{ type: 'boolean', description: 'True to keep the text out of the receipt, such as a password.' }` | src/core/constants.ts:617 |
| `BROWSER_TOOL_COPY.record` | § 7 description; `journey` (string, required) | src/core/constants.ts:701 |
| `BROWSER_TOOL_COPY.save` | § 7 description; `description` (string, required) | src/core/constants.ts:716 |
| `BROWSER_TOOL_COPY.journeys` | § 7 description; `what` (string, required), `offset` (integer); annotations `pure`, `untrusted` | src/core/constants.ts:731 |
| `BROWSER_TOOL_COPY.edit` | § 7 description; `journey` (string, required), `edits` (array, required) with an item schema of `operation` (enum `add`, `remove`, `update`, `declare`, required), `id`, `step`, `before`, `after`, `ref`, `arguments`, `name`, `parameter` | src/core/constants.ts:747 |
| `BROWSER_TOOL_COPY.replay` | § 7 description; `journey` (string, required), `inputs` (object, `additionalProperties: { type: 'string' }`) | src/core/constants.ts:809 |
| `// === Browser journeys` banner | | src/core/constants.ts:830 |
| `BROWSER_JOURNEY_NAME_PATTERN` | `/^(?=.{1,64}$)(?!(?:con\|prn\|aux\|nul\|com[1-9]\|lpt[1-9])$)[a-z0-9]+(?:-[a-z0-9]+)*$/` | src/core/constants.ts:841 |
| `BROWSER_JOURNEY_PARAMETER_PATTERN` | `/^[a-z][a-zA-Z0-9]*$/` | src/core/constants.ts:845 |
| `BROWSER_JOURNEY_FORMAT` | `1`, typed `BrowserJourney['format']` | src/core/constants.ts:848 |
| `BROWSER_JOURNEY_ACTIONS` | frozen `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `switch`, typed `readonly BrowserToolName[]` | src/core/constants.ts:857 |
| `BROWSER_JOURNEY_EMPTY_LISTING` | `'No journeys are saved; call record to start one.'` | src/core/constants.ts:868 |

The five tool descriptions are § 7's strings verbatim; each is at most 25 words (16, 13, 13, 18, and 13). Every parameter description is at most 100 characters. `BROWSER_TOOL_COPY`'s `@remarks` names `journeys` among the `pure` and `untrusted` tools, `type`'s `secret`, and that only a toolset constructed with `journeys` advertises the five journey tools.

The name pattern folds invariant 1's 64-character bound into a leading lookahead, as `BROWSER_TOOL_NAME_PATTERN` folds its `{1,64}`. A `node -e` probe over 21 inputs (`add-kettle`, `a`, `kettle2`, `con`, `nul`, `com1`, `com0`, `lpt9`, `conn`, `con-1`, `Add-kettle`, `add--kettle`, `-add`, `add-`, `add kettle`, `add.kettle`, the empty string, 64 and 65 `a` characters, a 65-character hyphenated name, and `add-kettle` with a trailing line feed) returned the same verdict from this pattern as from the design's pattern plus `length <= 64` on every input. The parameter pattern accepted `email`, `confirmPassword`, and `secret1`, and refused `Email`, `1a`, `a-b`, and `a_b`. The probe is deleted.

Refusal and render strings: the package holds a fixed receipt note, status, or footer as a constant (`BROWSER_TOOL_DEADLINE_NOTE`, `BROWSER_TOOL_HANDLED_STATUS`, `BROWSER_TOOL_CHANGED_NOTE`, `BROWSER_TOOL_CUT_FOOTER`, `BROWSER_TOOL_VIEW_FOOTER`), and writes every refusal message and every parameterized result inline at its throw or render site (`'No dialog is open; call look.'`, `` `Tab ${…} is not open; call tabs.` ``, the `read` footer). Of § 7's strings, `No journeys are saved; call record to start one.` is the one fixed result text, so it is the one constant. Every refusal, the parameterized results, the listing, the step templates, and the run render stay for J2 and J8 to write inline, verbatim.

## Error codes

`src/core/errors.ts` is unchanged (D2). The codes of § 11 row 7 for J2, J5, J8, and J9 to throw and J12 to document: `BROWSER_JOURNEY_FORMAT`, `BROWSER_JOURNEY_FILE`, `BROWSER_JOURNEY_ACCESS`, `BROWSER_JOURNEY_PATH`, `BROWSER_JOURNEY_LOCKED`, `BROWSER_JOURNEY_REVISION`, `BROWSER_JOURNEY_EDIT`, `BROWSER_JOURNEY_INPUT`, `BROWSER_JOURNEY_GAP`, `BROWSER_JOURNEY_PLACEMENT`, `BROWSER_JOURNEY_AMBIGUOUS`, `BROWSER_JOURNEY_TARGET`, and `BROWSER_TOOLSET_BUSY`.

## Validation

Every command ran from `/home/user/browser` through `env -C`.

| Command | Exit | Result |
| --- | --- | --- |
| `npx oxfmt --check` over the five owned files | 0 | All matched files use the correct format |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the five owned files | 0 | no diagnostic |
| `npm run check` | 0 | root, `check:src:core`, `check:src:server`, and `check:src:browser` green |
| `npm run test:policy` | 0 | 114 passed, 1 skipped (115); baseline at `6d8e8ed` identical |
| `npm run test:guides` | 1 | 2 failed, 205 passed (207); baseline at `6d8e8ed` 207 passed. `documents every barrel export` lists 40 undocumented exports (the 34 types and 5 constants of this unit, plus `BrowserCodegenScript`); `keeps every compared summary and example equal to its source` reports the `BrowserToolName` summary drift. Both are J12's |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts` | 1 | 1 failed, 129 passed (130); baseline at `6d8e8ed` 130 passed. The failure is D4 |
| `npm run test:src:core` | 1 | 1 failed, 861 passed (862), across 43 files; the one failure is D4 |

Type probe (deleted): `JSONValue` from `@orkestrel/contract` and the design's `BrowserJSONValue` fence are mutually assignable and equal under the `(<T>() => T extends A ? 1 : 2)` identity check (`tsc --strict`, exit 0); replacing the fence's `null` with `undefined` fails all three assertions (exit 2).

## Deviations

- D1, `BrowserJSONValue`: not declared. `@orkestrel/contract`, a declared runtime dependency, exports `JSONValue = JSONPrimitive | readonly JSONValue[] | JSONRecord`, which the type probe shows equal to the design's fence. `AGENTS.md` refuses a rename-wrap or a duplicate of a declared primitive whose semantics match, and § Fleet name ownership rule 1 reuses the owner's export. Every journey type that the design writes with `BrowserJSONValue` uses `JSONValue`. J2 and later units import `JSONValue` from `@orkestrel/contract`, never through this package's barrel.
- D2, error codes: `src/core/errors.ts` declares no code union. `BrowserError.code` is `string`; every code is a literal at its throw site and is documented in the Errors table of `guides/browser.md`, which J12 owns. The file has no row to add.
- D3, barrel: `src/core/index.ts` and `src/server/index.ts` already star-export `./types.js` and `./constants.js`, so every declaration of this unit reaches its barrel with no row added.
- D4, `type`'s `secret` row: the row is in the copy as the brief prescribes. `validateBrowserToolArguments` builds its refusal from the advertised keys, so the refusal for an unadvertised `type` argument now ends `call type with ref, text, submit, and secret.`, and `tests/src/core/BrowserToolset.test.ts:164`, outside this unit's files, fails. Patch P2 restores it. Until J4 lands, the `type` handler accepts `secret` and ignores it, so a direct `type` call with `secret: true` still echoes its text in the receipt.
- D5, `BrowserDocumentToolsetOptions` (§ 4) lives in `src/browser/types.ts`, outside this unit's files. Patch P1 adds `journeys` to its `Pick`.
- D6, `BROWSER_TOOL_NAMES` is unchanged. It feeds the toolset's reservation check at `start()` and the page-tool skip; adding the journey tools there would reserve them on every toolset, but invariant 21 reserves them only with `journeys`. J8 owns that reservation.
- D7, the design gives no parameter descriptions for the five tools. The descriptions are this unit's: `what` and `offset` on `journeys` reuse `tabs`'s and `read`'s wording, and `edits` carries an item schema that the design does not specify. J8 can tighten either; the copy is advertised only, because the toolset validates top-level keys alone.
- D8, `BROWSER_JOURNEY_FORMAT` names both the constant `1` (the brief) and an error code string (§ 2, § 11). The brief prescribed the constant name; the shared spelling is a one-concept-one-term hazard for J2 and J12 to rule on.

## Shared-file patches

Each patch applies to this tree (`git apply --check`, exit 0), and both patched files pass `oxfmt --check`.

P1, `src/browser/types.ts` (J3 or J8 integrates):

```diff
--- a/src/browser/types.ts
+++ b/src/browser/types.ts
@@ -32,12 +32,13 @@
  *   {@link BrowserDOMViewOptions} describes them
  * - `source` — a source of page tools, such as `@orkestrel/mcp`'s model context bridge; the
  *   toolset adopts its tools and re-adopts on its `change`. Default: no page tools
- * - `tools`, `limit`, `on`, and `error` — as {@link BrowserToolsetOptions} describes them
+ * - `tools`, `limit`, `journeys`, `on`, and `error` — as {@link BrowserToolsetOptions}
+ *   describes them
  */
 export interface BrowserDocumentToolsetOptions
 	extends
 		BrowserDOMViewOptions,
-		Pick<BrowserToolsetOptions, 'on' | 'error' | 'tools' | 'source' | 'limit'> {}
+		Pick<BrowserToolsetOptions, 'on' | 'error' | 'tools' | 'source' | 'limit' | 'journeys'> {}
 
 /**
  * Carries the accessible-name traversal context.
```

P2, `tests/src/core/BrowserToolset.test.ts` (J4 integrates, or the Orchestrator with this unit):

```diff
--- a/tests/src/core/BrowserToolset.test.ts
+++ b/tests/src/core/BrowserToolset.test.ts
@@ -161,7 +161,7 @@
 			expect(results.map((result) => readProperty(result, 'error'))).toEqual([
 				'The look tool takes no ref parameter; call look with what.',
 				'The read tool takes no ref parameter; call read with what and offset.',
-				'The type tool takes no what parameter; call type with ref, text, and submit.',
+				'The type tool takes no what parameter; call type with ref, text, submit, and secret.',
 			])
 			expect(view.calls).toEqual([])
 			const refused = await Promise.resolve(
```

## Names a later unit implements

Classes, one per interface, for the guide's class parity (§ 11 invariant 10):

| Class | Interface | Unit |
| --- | --- | --- |
| `BrowserHold` | `BrowserHoldInterface` | J4 |
| `BrowserRecorder` (`src/core/recorders/BrowserRecorder.ts`) | `BrowserRecorderInterface` | J5 |
| `BrowserReplay` (`src/core/BrowserReplay.ts`) | `BrowserReplayInterface` | J5 |
| `MemoryBrowserJourneyStore` | `BrowserJourneyStoreInterface` | J5 |
| `MemoryBrowserRunStore` | `BrowserRunStoreInterface` | J5 |
| `BrowserCodegen` (`src/core/recorders/BrowserCodegen.ts`) | `BrowserCodegenInterface extends BrowserRecorderInterface` | J6, J7 |
| `BrowserJourneyToolset` (`src/core/BrowserJourneyToolset.ts`) | `BrowserJourneyToolsetInterface` | J8 |
| `FileBrowserJourneyStore` (`src/server/stores/`) | `BrowserJourneyStoreInterface` | J9 |
| `FileBrowserRunStore` (`src/server/stores/`) | `BrowserRunStoreInterface` | J9 |
| `BrowserMCPServer` (`src/server/BrowserMCPServer.ts`) | `BrowserMCPServerInterface` | J10 |

Interface members deferred to their units: `BrowserToolsetInterface.perform` and `.hold`, the `action`, `hold`, and `release` emissions, and the `type` tool's `secret` receipt (J4); `BrowserViewInterface<E>` and `BrowserPageInterface extends BrowserViewInterface<BrowserPageElementInterface>`, and `exact` in both element managers (J3); `BrowserCodegenInterface.script(options): BrowserCodegenScript` (J6, J7).

Functions: `validateBrowserJourney`, `parseBrowserJourney`, `editBrowserJourney`, `locateBrowserTarget`, `renderBrowserJourney`, `renderBrowserRun`, the run id, the secret-name derivation, and `trigger` (J2); `performBrowserStep` (J4); `createBrowserRecorder`, `createBrowserReplay`, `createMemoryBrowserJourneyStore`, and `createMemoryBrowserRunStore` (J5); `compileBrowserJourney` (J7); `createFileBrowserJourneyStore` and `createFileBrowserRunStore` (J9); `createBrowserMCPServer` (J10).
