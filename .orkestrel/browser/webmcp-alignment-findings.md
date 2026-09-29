# accuracy: FAIL

## acc-1 [blocking]
CLAIM: "The specification repository carries no test suite of its own, so nothing official can be run against this package; the vendored coordinates are the authority until one exists." (PROPOSAL.md:71; tmp/units/relation-section.md:16), echoed by the Evidence row "holds no test or web-platform-tests directory" (PROPOSAL.md:568).
FAILING: The raw specification source fetched 2026-09-29 declares its test suite in its metadata block: `Test Suite: https://wpt.fyi/results/webmcp` (index.bs line 20 of the 86 547-byte file). web-platform-tests carries a `webmcp/` directory: `webmcp/META.yml` and `webmcp/idlharness.https.window.js` (an `idl_test(['webmcp'], ['html','dom'])` over the webref-extracted `interfaces/webmcp.idl`) both answer 200 from raw.githubusercontent.com, and the wpt.fyi search API on 2026-09-29 lists 74 test paths under `/webmcp/` (`idlharness.https.window.html`, `tool-activated-event.https.html`, `tool-cancel-event.https.html`, 24 under `declarative/`, 47 under `imperative/` such as `register_tool_name_validation.https.html` and `getTools-imperative-annotations.https.html`), with `idlharness` reported 22 of 22 on Chrome 156.0.8072.0. The first clause (no tests directory in the spec repository) is true; the inference that nothing official exists or can run is false, and the recorded reader had flagged the gap: "upstream web-platform-tests not checked for WebMCP tests" (tmp/units/webmcp-read-surface.md, gaps). Those tests drive `document.modelContext` in a browser, which is what `tests/fixtures/modelContext.ts` doubles, so official rows can run against this package's double. Note the two official IDL sources also disagree on that date: webref's `interfaces/webmcp.idl` declares `ontoolchange` only and no `debugging`, while `index.bs` lines 621-623 and 1118 declare all four.
CITE: PROPOSAL.md:71; PROPOSAL.md:568; tmp/units/webmcp-read-surface.md (gaps: "upstream web-platform-tests not checked"); index.bs:20 (raw, 2026-09-29); wpt.fyi /api/search?q=webmcp (74 paths, 2026-09-29)
FIX: Replace the sentence at PROPOSAL.md:71 with: "The specification names its test suite at wpt.fyi/results/webmcp (`index.bs:20`), and web-platform-tests carries `webmcp/` (an `idlharness` over webref's `interfaces/webmcp.idl`, plus `imperative/` and `declarative/` cases; 74 paths on 2026-09-29); those drive `document.modelContext` in a browser, so U17 rules per row whether the IDL double runs it, and the vendored coordinates stay the mirror for the protocol domain, which WPT does not cover. webref's IDL lags `index.bs` on `ontoolactivated`, `ontoolcancel`, and `debugging`, so `index.bs` is the pinned authority." Correct PROPOSAL.md:568 to the same reading and add a U17 acceptance row that runs `webmcp/idlharness.https.window.js`'s IDL against the double or rules it excluded with its closer.

## acc-2 [required]
CLAIM: U17 acceptance 5: publishing `toolset.native` through `createModelContext` "registers exactly the seven generic descriptors" under the Playwright provider (PROPOSAL.md:809; tmp/units/u17-section.md:13).
FAILING: The composition case in the same row is `createDocumentToolset({ document, source: bridge })`, the DOM placement, whose native set is five: "7 tools on CDP, 5 in the DOM placement" (PROPOSAL.md:164) and "The DOM toolset lists exactly `look`, `read`, `click`, `type`, and `wait`" (PROPOSAL.md:731, U10 acceptance 4). Seven is the CDP count (PROPOSAL.md:682). An executor asserting seven registrations under the browser project fails against U10.
CITE: PROPOSAL.md:809; PROPOSAL.md:164; PROPOSAL.md:731; PROPOSAL.md:682
FIX: At PROPOSAL.md:809 write "registers exactly the DOM placement's five generic descriptors (`look`, `read`, `click`, `type`, `wait`) with the projected hints".

## acc-3 [required]
CLAIM: U17 acceptance 4 asserts "`autosubmit` and `backendNodeId` to the `[tool=NAME]` mark" from the registry's adoption (PROPOSAL.md:808; tmp/units/u17-section.md:12).
FAILING: No design text maps `autosubmit` to anything. The protocol declares it as "If the declarative tool was declared with the autosubmit attribute" (tmp/units/browser_protocol.json:30876-30881); the proposal carries it only as `BrowserToolAnnotation.autosubmit` (PROPOSAL.md:326), and the mark derives from `node`, the parsed `backendNodeId`: "A declarative form tool (`node` defined) receives a reference and the outline marks its form `[tool=NAME]`" (PROPOSAL.md:389). The adapter table's declarative row names `backendNodeId` and the `toolname` attribute only (PROPOSAL.md:69). An executor has no rule from which to write the `autosubmit` assertion.
CITE: PROPOSAL.md:808; PROPOSAL.md:326; PROPOSAL.md:389; PROPOSAL.md:69; tmp/units/browser_protocol.json:30876-30881
FIX: At PROPOSAL.md:808 drop `autosubmit` from the mark clause and add it to the ruled row table as retain (carried on `annotation.autosubmit`, read by no consumer) or exclude with its closer.

## acc-4 [required]
CLAIM: The declared name gap: "a name with a period is skipped and the declared gap names the provider charset as the reason" (PROPOSAL.md:808) and "A page tool whose name carries a period is skipped, because the provider charset excludes it; the declared gap names the rule" (PROPOSAL.md:828).
FAILING: The provider charset is `^[A-Za-z0-9_-]{1,64}$` (PROPOSAL.md:389) while the specification allows 1 to 128 code points (index.bs:158-160, raw 2026-09-29: "must be between 1 and 128, inclusive"; tmp/units/webmcp-read-surface.md name rule; U17 row 3 at PROPOSAL.md:807 states 128). A specification-valid name of 65 to 128 code points is also skipped, and the declared gap names only the period, so the executor's gap row under-states the mismatch by the length bound.
CITE: PROPOSAL.md:808; PROPOSAL.md:828; PROPOSAL.md:389; PROPOSAL.md:807
FIX: At PROPOSAL.md:808 and PROPOSAL.md:828 write "a name with a period or longer than 64 code points is skipped, and the declared gap names both the charset and the 64 bound against the specification's 128".

## acc-5 [required]
CLAIM: U17 acceptance 2: "every property of the mirror's `Tool`, `Annotation`, and `RemovedTool` types and every value of `InvocationStatus` is one `parseBrowserTool` and `parseBrowserInvocationResult` name" (PROPOSAL.md:806; tmp/units/u17-section.md:10).
FAILING: `Tool` declares seven properties: `name`, `description`, `inputSchema`, `annotations`, `frameId`, `backendNodeId`, `stackTrace` (tmp/units/browser_protocol.json:30898-30938; `stackTrace` at 30933). `BrowserTool` carries six members and none for `stackTrace` (PROPOSAL.md:328-335: `name`, `description`, `schema`, `annotation`, `frame`, `node`), and U6 nowhere names `stackTrace` (PROPOSAL.md:655-671). Unlike the IDL rows, which are "ruled implement, retain, or exclude in a table the test reads" (PROPOSAL.md:807), the domain rows have no ruling path, so the `stackTrace` row reddens on day one or forces a parser that names a member only to drop it.
CITE: PROPOSAL.md:806; PROPOSAL.md:328-335; PROPOSAL.md:807; tmp/units/browser_protocol.json:30933
FIX: At PROPOSAL.md:806 give the domain rows the same ruled table as the IDL rows and rule `stackTrace` exclude with its closer (a registration-site reading no consumer asks for), or add `stack: unknown | undefined` to `BrowserTool` in U6.

## acc-6 [required]
CLAIM: The declarative adapter row's proof is "U4 and U10" (PROPOSAL.md:69; tmp/units/relation-section.md:12).
FAILING: Neither U4's acceptance (PROPOSAL.md:629-640) nor U10's (PROPOSAL.md:727-734) contains a `[tool=NAME]` row; the only acceptance row for the mark is U17's row 6 (PROPOSAL.md:810), and U17's Owns names `src/browser/elements/BrowserDOMElementManager.ts` and `src/core/elements/BrowserElementManager.ts` "(the `[tool=NAME]` marks)" (PROPOSAL.md:802), files U4 (PROPOSAL.md:627) and U10 (PROPOSAL.md:725) also own. An executor following the table to U4 or U10 finds no proof, and three units own the same two files.
CITE: PROPOSAL.md:69; PROPOSAL.md:802; PROPOSAL.md:810; PROPOSAL.md:627; PROPOSAL.md:725
FIX: At PROPOSAL.md:69 write the Proof cell as "U17 row 6"; either drop the two element-manager files from U17's Owns and add a `[tool=NAME]` acceptance row to U4 and U10, or keep them in U17 and say so in U4 and U10.

## acc-7 [required]
CLAIM: "the guide's 'Declared conformance gaps' section names each exclusion with its closer, as mcp's guide does for its bridge (`../mcp/guides/mcp.md:4901`)" (PROPOSAL.md:61; tmp/units/relation-section.md:14), and U12's "a 'Declared conformance gaps' section naming each excluded row and its closer, as mcp's guide does" (PROPOSAL.md:754).
FAILING: mcp's "Declared conformance gaps" section (../mcp/guides/mcp.md:4932 onward) covers the `@modelcontextprotocol/conformance` runner and the Tasks schema mirror and names no bridge row; the bridge's exclusions are the verdict column of the "WebMCP parity" table (../mcp/guides/mcp.md:4901-4930), and each exclude verdict there carries a reason ("index.bs marks that section 'entirely a TODO'", "issue #282 leaves the shape open"), not a closer. "Closer:" entries exist only in the gaps section for non-bridge gaps (for example the HTTP-consumption entry near ../mcp/guides/mcp.md:5050). The bridge reader recorded the same: "'conformance' in mcp means the `@modelcontextprotocol/conformance` MCP-wire runner only" (tmp/units/webmcp-read-bridge.md, summary). The precedent as stated does not exist in the cited section.
CITE: PROPOSAL.md:61; PROPOSAL.md:754; ../mcp/guides/mcp.md:4901; ../mcp/guides/mcp.md:4932; tmp/units/webmcp-read-bridge.md (summary)
FIX: At PROPOSAL.md:61 and PROPOSAL.md:754 write: "as mcp's 'WebMCP parity' table rules its bridge rows (`../mcp/guides/mcp.md:4901`), with each exclusion here additionally naming its closer in the shape of mcp's 'Declared conformance gaps' entries (`../mcp/guides/mcp.md:4932`)".

## acc-8 [required]
CLAIM: U17 acceptance 5's absence path "asserts `bridge !== undefined` equals `'modelContext' in document` so a host that ships the registry reddens rather than skipping" (PROPOSAL.md:809; tmp/units/u17-section.md:13).
FAILING: The Chrome intent locates the registry on `Navigator.modelContext` (tmp/units/webmcp-research-report.md § 2; PROPOSAL.md:565; Limits at PROPOSAL.md:820 records the location as unsettled), and `createModelContext` reads only `options.document ?? globalThis.document` through `isWebMCPDocument` (../mcp/src/browser/factories.ts:452-461). On a host that ships `navigator.modelContext`, `bridge` is `undefined` and `'modelContext' in document` is `false`, the equality holds, and the block skips silently on exactly the host the row exists to catch. P1 read both locations (tmp/units/probe-cdp-native-3.log, P1: "exposes no WebMCP registry"; PROPOSAL.md:524).
CITE: PROPOSAL.md:809; PROPOSAL.md:565; PROPOSAL.md:820; ../mcp/src/browser/factories.ts:452-461
FIX: At PROPOSAL.md:809 add "and asserts `'modelContext' in navigator` is `false`, so a registry at either location reddens".

## acc-9 [optional]
CLAIM: "mcp 0.0.33's bridge, read on 2026-09-15, does not name ..." (PROPOSAL.md:71; tmp/units/relation-section.md:16).
FAILING: The date belongs to the bridge's reading of the specification, not to a reading of the bridge: the types transliterate the WebIDL as read 2026-09-15 (../mcp/src/browser/types.ts:209-213), and the bridge itself was read on 2026-09-29 (tmp/units/webmcp-read-bridge.md, summary: "transliterated from the WebIDL as read 2026-09-15"). The Evidence row states it correctly ("declares the 2026-09-15 surface", PROPOSAL.md:567).
CITE: PROPOSAL.md:71; ../mcp/src/browser/types.ts:209-213; PROPOSAL.md:567
FIX: Write "mcp 0.0.33's bridge, which transliterates the draft as read on 2026-09-15".

## acc-10 [optional]
CLAIM: U17 acceptance 2: "the `invokeTool` description still states the response precedes tool events" (PROPOSAL.md:806; tmp/units/u17-section.md:10).
FAILING: The `invokeTool` command's description is "Invokes a registered tool." (tmp/units/browser_protocol.json:30969); the sentence "Response is sent before tool events." is the description of its `invocationId` return (tmp/units/browser_protocol.json:30990), which PROPOSAL.md:384 cites correctly. A row written against the command description matches nothing.
CITE: PROPOSAL.md:806; tmp/units/browser_protocol.json:30969; tmp/units/browser_protocol.json:30990
FIX: Write "the `invokeTool` return `invocationId`'s description still states the response precedes tool events".

## acc-11 [optional]
CLAIM: "Two adapters carry WebMCP tools into that model, one per direction the specification defines" (PROPOSAL.md:60; tmp/units/relation-section.md:6).
FAILING: The specification defines the in-page registry and the declarative form only; the `WebMCP` protocol domain is Chromium's DevTools affordance outside the specification (tmp/units/webmcp-cdp-domain.md, source: devtools-protocol `browser_protocol.json`), and the README paraphrase records that external agents cannot directly access WebMCP tools (tmp/units/webmcp-research-report.md § 1). The "outside" direction is the protocol's, not the specification's.
CITE: PROPOSAL.md:60; tmp/units/webmcp-cdp-domain.md; tmp/units/webmcp-research-report.md § 1
FIX: Write "one per placement: the protocol domain outside the browser and the registry inside it".

## acc-12 [optional]
CLAIM: The WebIDL mirror is "at a named `index.bs` revision" (PROPOSAL.md:61) and is named `tests/mirrors/webmcp-idl-DATE.bs` with "`DATE` the draft date" (PROPOSAL.md:802).
FAILING: The two sentences pin by different keys. The raw `index.bs` metadata block (lines 1-20) carries `Status: CG-DRAFT` and no `Date:` line, and the published draft's date is the build date (`<time datetime="2026-09-29">` on the rendered page), which changes with every build rather than with the IDL; the reader also recorded that the commit SHA was not obtained (tmp/units/webmcp-read-surface.md, gaps). A date names no fixed bytes.
CITE: PROPOSAL.md:61; PROPOSAL.md:802; tmp/units/webmcp-read-surface.md (gaps: "Spec date, Status and commit SHA not obtained")
FIX: Name the IDL mirror `webmcp-idl-REVISION.bs` with `REVISION` the `webmachinelearning/webmcp` commit, as the domain mirror is named.

## acc-13 [optional]
CLAIM: U17 acceptance 5: `createDocumentToolset({ document, source: bridge })` "adopts a page tool the double registers with `untrusted` true and `pure` from `readOnlyHint`" (PROPOSAL.md:809).
FAILING: mcp's `webMCPAnnotationsToTool` maps `untrustedContentHint` to `untrusted` faithfully and forces nothing (../mcp/src/browser/helpers.ts:50-59), while the design advertises page tools as "`untrusted` always" (PROPOSAL.md:183) and "outputs are `untrusted` regardless of the page's hint" (PROPOSAL.md:834). As written, a double that registers `untrustedContentHint: true` satisfies the row through mcp's mapping alone and proves nothing about this package's override.
CITE: PROPOSAL.md:809; ../mcp/src/browser/helpers.ts:50-59; PROPOSAL.md:183; PROPOSAL.md:834
FIX: Write "a page tool the double registers with `readOnlyHint` true and no `untrustedContentHint`, adopted with `untrusted` true and `pure` true".

## acc-14 [optional]
CLAIM: Evidence row: "names of 1 to 128 characters from alphanumerics, underscore, hyphen, and period" (PROPOSAL.md:564).
FAILING: The rule is ASCII alphanumeric code points (index.bs:158-160, raw 2026-09-29; tmp/units/webmcp-read-surface.md name rule), and U17 row 3 says "code points of ASCII alphanumerics" (PROPOSAL.md:807). "Characters" without "ASCII" admits non-ASCII letters the rule refuses.
CITE: PROPOSAL.md:564; PROPOSAL.md:807; tmp/units/webmcp-read-surface.md (name validation rule)
FIX: Write "names of 1 to 128 code points from ASCII alphanumerics, underscore, hyphen, and period".

## held
- Domain inventory against tmp/units/browser_protocol.json:30839-31094: `Annotation` {readOnly, untrustedContent, consequential, debugging, autosubmit}; `InvocationStatus` {Completed, Canceled, Error}; `Tool` {name, description, inputSchema, annotations, frameId, backendNodeId, stackTrace}; `RemovedTool` {name, frameId}; commands enable, disable, invokeTool, cancelInvocation; events toolsAdded, toolsRemoved, toolInvoked, toolResponded. U17 and the adapter table name no member the domain lacks; `BrowserInvocation` and `BrowserInvocationResult` (PROPOSAL.md:337-349) match `toolInvoked` (input as string) and `toolResponded` (exception folded into `error`); the `toolResponded.output` untrusted note is at 31078 as cited.
- IDL rows (U17 acceptance 3) against the raw `index.bs` fetched 2026-09-29 (86 547 bytes): `ModelContext` declares `registerTool`, `getTools`, `executeTool`, `ontoolchange`, `ontoolactivated`, `ontoolcancel` (lines 617-623); `ToolAnnotations` declares `readOnlyHint`, `untrustedContentHint`, `consequentialHint`, `debugging` (1115-1118); `executeTool` returns `Promise<DOMString>` (619); the name rule is 1 to 128 inclusive, ASCII alphanumeric code points, U+005F, U+002D, U+002E (158-160); `ToolActivatedEvent` and `ToolCancelEvent` exist (295, 492-493, 1369). The recorded summarising fetch (tmp/units/webmcp-read-surface.md) matches the raw bytes on every member the proposal names.
- Adapter table row 2 (mcp's mapping): `toolAnnotationsToWebMCP` and `webMCPAnnotationsToTool` map `pure`/`readOnlyHint`, `untrusted`/`untrustedContentHint`, `consequential`/`consequentialHint` in both directions and invent no default (../mcp/src/browser/helpers.ts:29-59), as the table states.
- Adapter table row 1 and U17 row 4 (this package's CDP mapping): `readOnly` to `pure`, `consequential` to `consequential`, `untrusted` always `true` is stated identically at PROPOSAL.md:183, PROPOSAL.md:386, and U6 acceptance 7 (PROPOSAL.md:670).
- "mcp 0.0.33's bridge ... does not name" `ontoolactivated`, `ontoolcancel`, `debugging`: a case-insensitive grep of /home/user/mcp/src for `ontoolactivated|ontoolcancel|toolactivated|toolcancel|debugging` matches nothing; `WebMCPAnnotations` carries the three hints only (../mcp/src/browser/types.ts:229-233, inside the cited 218-233); `WEBMCP_CHANGE_EVENT = 'toolchange'` (../mcp/src/browser/constants.ts:22); `executeTool` is typed `Promise<unknown>` (../mcp/src/browser/types.ts:363-367), as the Evidence row states; the package version is 0.0.33 (../mcp/package.json:3).
- Chromium 141 ships no registry (P1, P15): tmp/units/probe-cdp-native-3.log records P1 "this Chromium exposes no WebMCP registry (control: document.body exists)" passed, and tmp/units/probe-cdp-native-series3c.log records P15 "WebMCP.enable on this Chromium rejects with a CDPError whose code is -32601 and Schema.getDomains lists no WebMCP; Page.enable resolves" passed; the probe source reads both `'modelContext' in document` and `in navigator` (tmp/probes/cdp-native.test.ts:111).
- `createPageServer` (../mcp/src/browser/factories.ts:381), `createScopeServer` (:187), and `createModelContext` with `publish` and `adopt` (:452-461; ../mcp/src/browser/ModelContext.ts) exist as named; no exported mcp class or interface carries an `Adapter` or `Bridge` suffix (grep of /home/user/mcp/src), and `isWebMCPDocument` is an mcp export (../mcp/src/browser/validators.ts:59), so the `describe.runIf` guard resolves.
- Rule and precedent citations resolve: `tests/conformance.test.ts` row at ../scaffold/.claude/rules/tests.md:56; the vendored-mirror exemption at ../scaffold/.claude/rules/writing.md:30; `TASK_SCHEMA_DIGEST`, `TASK_SCHEMA_ID`, `TASK_SCHEMA_PATH` at ../mcp/tests/setupConformance.ts:166-174 with the digest read throwing at module load (:252-263); the mirror's `$schema`, `$id`, `title` at ../mcp/tests/mirrors/ext-tasks-2026-07-28-schema.json:1-4; "## WebMCP parity" at ../mcp/guides/mcp.md:4901; D3 at PROPOSAL.md:28.
- "the same header exemption mcp's carries": ../mcp/tests/fixtures/modelContext.ts:1-16 declares the double a protocol-faithful boundary stub of a foreign surface, "the one substitution the test contract permits", implementing the IDL member for member.
- Chrome DevTools MCP 1.10.1 and its "Chrome 150+ with `--enable-features=WebMCP`" requirement, Puppeteer's `page.webmcp`, the intent's `Navigator.modelContext` against the draft's `document.modelContext`, and the M146/M149-M156/M157 milestones are as recorded (tmp/units/webmcp-research-report.md § 2-3; tmp/units/webmcp-cdp-domain.md).
- The Goals bullet, rulings 26 and 27, U13's `npm test` chaining `test:conformance`, Limits rows 820, 822-827, and the `[tool=NAME]` example form at PROPOSAL.md:199 state nothing the sources contradict beyond the findings listed.

# rules: FAIL

## rul-1 [blocking]
CLAIM: U17 owns `tests/src/browser/conformance.test.ts` as the home of the composition cases.
FAILING: The vendored mirror rule reserves only `integration.test.ts` (tests/setupPolicy.ts:451); `tests/src/browser/conformance.test.ts` yields the stem `src/browser/conformance`, whose candidates are `src/browser/conformance.{ts,tsx,mts,cts,vue,scss,css}`; no unit creates that module, so `inspectPolicyMirrorPaths` emits a `mirror` violation (tests/setupPolicy.ts:481-500; control at :2663-2667) and `npm run test:policy`, which `npm test` runs (package.json:69) and U13 gates (PROPOSAL.md:768), exits non-zero.
CITE: /home/user/browser/PROPOSAL.md:802; /home/user/browser/tests/setupPolicy.ts:449-454,481-500; /home/user/scaffold/.claude/rules/tests.md:13-14,76
FIX: Put the composition cases in `tests/src/browser/factories.test.ts`, the mirror of `src/browser/factories.ts` that owns `createDocumentToolset` (PROPOSAL.md:726), and delete `tests/src/browser/conformance.test.ts` from U17's Owns.

## rul-2 [blocking]
CLAIM: U17 acceptance 5: publishing `toolset.native` from the DOM toolset "registers exactly the seven generic descriptors".
FAILING: The composition runs under the Playwright provider through `createDocumentToolset`; the DOM placement advertises 5 tools (PROPOSAL.md:169) and U10 acceptance 4 lists exactly `look`, `read`, `click`, `type`, and `wait` (PROPOSAL.md:732); `native` is the generic tools alone (PROPOSAL.md:165), so the double receives five registrations and a row expecting seven reddens on a correct build.
CITE: /home/user/browser/PROPOSAL.md:809 against :169, :165, :732
FIX: Replace "exactly the seven generic descriptors" with "exactly the five generic descriptors the DOM placement advertises (`look`, `read`, `click`, `type`, `wait`)".

## rul-3 [required]
CLAIM: U17 owns `tests/fixtures/modelContext.ts`, this package's IDL-faithful double, and depends on U10.
FAILING: U10 acceptance 5 already drives "publishing `native` through an IDL-faithful registry double" (PROPOSAL.md:733), yet the double is created by U17, which runs after U10 (PROPOSAL.md:803): U10's executor cannot satisfy its acceptance without writing a second double. The double is also a DOM test fixture, which tests.md places in `tests/setupBrowser.ts` (U10-owned, PROPOSAL.md:726), exported from a setup file; mcp's `tests/fixtures/` placement is evidence, not authority (AGENTS.md:8).
CITE: /home/user/browser/PROPOSAL.md:802-803 against :733; /home/user/scaffold/.claude/rules/tests.md:186,198; /home/user/scaffold/AGENTS.md:8
FIX: Move the double into U10's Owns (declared in `tests/setupBrowser.ts`, or in `tests/fixtures/modelContext.ts` with the mcp precedent named as the reason), and have U17 consume it.

## rul-4 [required]
CLAIM: Relation table row 3: the declarative-form adapter's proof is "U4 and U10".
FAILING: Neither U4's acceptance (PROPOSAL.md:630-641) nor U10's (:728-735) names `[tool=NAME]` or `toolname`; U4 depends on U2 and U3 only (:629), so it holds no registry and cannot mark a registered tool's `backendNodeId`; U17 owns both element managers for the marks (:802) and proves them in acceptance 6 (:810). An executor of U4 or U10 builds no mark, and the row's proof pointer resolves to nothing.
CITE: /home/user/browser/PROPOSAL.md:69 against :629-641, :728-735, :802, :810
FIX: Change the row's Proof cell to "U17" (or add the mark case to U4 and U10's acceptance and remove the element managers from U17's Owns).

## rul-5 [required]
CLAIM: U17 acceptance 4: `debugging` to skip, the period-name skip, and `autosubmit` and `backendNodeId` to the `[tool=NAME]` mark "are asserted from the registry's adoption".
FAILING: `registry.adopt()` projects hints and adds `what` (PROPOSAL.md:386); the skips for `debugging` and a period name are the toolset's adoption policy with `skip` emitted (PROPOSAL.md:389; U7 acceptance 5 at :686), and the mark is derived from `node`/`backendNodeId` or the `toolname` attribute (:389, :69). Nothing in the design maps `autosubmit` to the mark, so a row asserting either from `registry.adopt()` reddens or pushes toolset behavior into the registry.
CITE: /home/user/browser/PROPOSAL.md:808 against :386, :389, :686, :69
FIX: Attribute the three hint rows to `registry.adopt()`, the `debugging` and period-name rows to `BrowserToolset`'s `skip` (cite U7 acceptance 5), the mark to acceptance 6, and delete `autosubmit` from the mark mapping or state that it is carried on `BrowserToolAnnotation` unmarked.

## rul-6 [required]
CLAIM: U17 acceptance 2: every property of the mirror's `Tool`, `Annotation`, and `RemovedTool` is one `parseBrowserTool` or `parseBrowserInvocationResult` name.
FAILING: The vendored `Tool` carries `stackTrace?: Runtime.StackTrace` (tmp/units/browser_protocol.json WebMCP domain; tmp/units/webmcp-read-surface.md:12), which `BrowserTool` omits (PROPOSAL.md:329-336) and the proposal never rules; `RemovedTool` has no parser among U6's `parseBrowserTool`, `parseBrowserInvocation`, and `parseBrowserInvocationResult` (:661). The unconditional row fails on the design's own contract, and unlike the IDL rows (:807) it carries no implement/retain/exclude ruling.
CITE: /home/user/browser/PROPOSAL.md:806 against :329-336, :661; /home/user/browser/tmp/units/webmcp-read-surface.md:12-13
FIX: Give the domain rows the same implement/retain/exclude table the IDL rows read, rule `stackTrace` (exclude, a developer datum) with its closer, and map `RemovedTool` to the `(frame, name)` key `toolsRemoved` removes.

## rul-7 [required]
CLAIM: U17 acceptance 2: "the `invokeTool` description still states the response precedes tool events".
FAILING: `invokeTool.description` in the vendored domain is "Invokes a registered tool."; the sentence "Response is sent before tool events." is the description of the `invocationId` return (tmp/units/browser_protocol.json, `WebMCP.invokeTool.returns[0]`; tmp/units/webmcp-read-surface.md:14), the coordinate the proposal itself cites at :385 (`:30990`). A row reading the command description reddens against a correct mirror.
CITE: /home/user/browser/PROPOSAL.md:806 against /home/user/browser/tmp/units/webmcp-read-surface.md:14 and PROPOSAL.md:385
FIX: Write "the `invokeTool` return `invocationId` description still states the response precedes tool events".

## rul-8 [required]
CLAIM: U17 acceptance 1: `tests/setupConformance.test.ts` "proves a mirror whose bytes differ from the pinned digest throws at module load, with a control mirror that loads".
FAILING: Re-loading the setup module against different bytes needs module replacement (AGENTS.md:40 bans it) or a rewrite of the tracked mirror; the mcp precedent the section claims to follow asserts the digest in a test through `readFileDigest` and `readConformanceDrift` (../mcp/tests/conformance.test.ts:196-205, ../mcp/tests/setupConformance.ts:165-174), not at module load. As written the executor is steered toward a banned mechanism.
CITE: /home/user/browser/PROPOSAL.md:805 and :61 against /home/user/scaffold/AGENTS.md:40 and /home/user/mcp/tests/conformance.test.ts:196-205
FIX: Restate the proof as: the exported mirror reader throws on a digest mismatch against a scratch copy (`createScratch`) and returns the pinned mirror on a match; the module-load pin is the setup module's top-level call of that reader.

## rul-9 [optional]
CLAIM: U17 makes a second copy of mcp's IDL-faithful double without stating why the reuse rule permits it.
FAILING: `@orkestrel/mcp` publishes `dist/src` and `README.md` only (../mcp/package.json:22-25), so the double is not an installed capability the reuse rule can reach (AGENTS.md:43); the text leaves the executor to rediscover this, and tests.md:178 names `@orkestrel/test` as the home for a helper two workspaces repeat.
CITE: /home/user/browser/PROPOSAL.md:802; /home/user/mcp/package.json:22-25; /home/user/scaffold/AGENTS.md:43; /home/user/scaffold/.claude/rules/tests.md:178
FIX: Add after the Owns entry: "copied because mcp ships no test surface (`../mcp/package.json:22-25`); consolidation into `@orkestrel/test` is a fleet unit".

## rul-10 [optional]
CLAIM: The guide's "Declared conformance gaps" section "names each exclusion with its closer, as mcp's guide does for its bridge (`../mcp/guides/mcp.md:4901`)".
FAILING: mcp's exclude rows (../mcp/guides/mcp.md:4921-4930) carry a verdict and a Source column and name no closer; the comparison attributes to the precedent something it does not do.
CITE: /home/user/browser/PROPOSAL.md:61 against /home/user/mcp/guides/mcp.md:4911-4930
FIX: Write "as mcp's guide rules each row with its source (`../mcp/guides/mcp.md:4901`); this package adds the closer".

## rul-11 [optional]
CLAIM: "No entity in this package is named after WebMCP".
FAILING: U6 adds a `WebMCP` script to `CDPTestServer` (PROPOSAL.md:661) and U17's double carries `ModelContext*` names; acceptance 7 (:811) scopes the rule to exported names in `src`, which the sentence does not.
CITE: /home/user/browser/PROPOSAL.md:59 against :661, :802, :811
FIX: Write "No exported entity in this package is named after WebMCP".

## rul-12 [optional]
CLAIM: Two mirrors are "vendored as fetched bytes": the `WebMCP` domain slice of `browser_protocol.json` and the WebIDL block of `index.bs`.
FAILING: A slice produced by parsing and re-serializing the domain is a translation, not the fetched bytes: no comparison against upstream bytes can check it (documentation.md:53), and the writing.md:30 exemption presumes fetched bytes. mcp vendors the whole schema file (../mcp/tests/mirrors/ext-tasks-2026-07-28-schema.json). The text leaves the cutting method open.
CITE: /home/user/browser/PROPOSAL.md:61, :802; /home/user/scaffold/.claude/rules/documentation.md:53; /home/user/scaffold/.claude/rules/writing.md:30
FIX: State that each mirror is cut by raw byte range from the fetched file, with the upstream offsets recorded beside the digest, or vendor the whole file as mcp does.

## held
- `tests/conformance.test.ts` as the fixed home, run in Node with the browser disabled from `npm test`: matches tests.md:56, workspace.md:140 and :162-163, and the mcp project shape (../mcp/vite.config.ts:302-316); `tests/setupConformance.test.ts` lands in the Node `setup` project (browser vite.config.ts:213).
- Mirror bytes survive the format gate: the browser `.prettierignore` already excludes `tests/mirrors/`, so `npm run format` rewrites nothing there; the `.bs` file sits outside the prose sweep, which reads `.md` only (tests/setupPolicy.ts:2015), and outside the mirror rule, which reads `*.test.ts` only (tests/setupPolicy.ts:452).
- Composing mcp's real bridge with this package's DOM toolset over an IDL-faithful double is a permitted boundary stub, not a mock: the double stands in for a foreign platform surface no browser ships, implements the IDL minimally, and replaces no part of the bridge or toolset under test (AGENTS.md:40; tests.md:30; ../mcp/tests/fixtures/modelContext.ts:1-16).
- The `describe.runIf(isWebMCPDocument(document))` block with the absence path asserting `bridge !== undefined` equals `'modelContext' in document` cites the mechanism, not the platform (tests.md:39), and matches the mcp precedent (../mcp/tests/src/browser/ModelContext.test.ts:1170; ../mcp/tests/src/browser/factories.test.ts:1337).
- The `[tool=NAME]` mark passes the creation gate: its first real consumer is the outline the model reads through `look` (PROPOSAL.md:199, :389), so no capability is created without a consumer (AGENTS.md:63).
- `@orkestrel/mcp` as a development dependency was authorized by the owner's quoted sentence (PROPOSAL.md:24), satisfying AGENTS.md:36; no runtime edge is added (PROPOSAL.md:30).
- The adapter table and the section name no export containing `WebMCP` or `ModelContext` and re-export no mcp symbol; acceptance 7 (PROPOSAL.md:811) pins ruling 26 (PROPOSAL.md:512); `createModelContext`, `createScopeServer`, and `isWebMCPDocument` resolve under `@orkestrel/mcp/browser` (../mcp/src/browser/index.ts:3,8; ../mcp/package.json:41).
- `BrowserToolAnnotation` keeps the wire spelling `readOnly` and `untrustedContent` with TSDoc naming the source, as names.md:120-122 requires (PROPOSAL.md:380).
- The four command names and four event names, the `toolResponded.output` untrusted note, the `Annotation` members, and `InvocationStatus` values match the vendored domain (tmp/units/browser_protocol.json; tmp/units/webmcp-cdp-domain.md:9-34).
- Every rule and precedent citation resolves: tests.md:56; writing.md:30; ../mcp/tests/setupConformance.ts:165-174; ../mcp/tests/mirrors/ext-tasks-2026-07-28-schema.json:1-4; ../mcp/guides/mcp.md:4901; ../mcp/src/browser/types.ts:218-233 (three hints, no `debugging`); ../mcp/src/browser/constants.ts:22 (`toolchange` only).
- Engine and order against .agents/orchestration.md: `astra` with an objective `reviewer` matches U4, U7, and U11 (PROPOSAL.md:627, :678, :741); U17's dependency on U10 reaches U9, U7, U6, U5, and U4 transitively, so `vite.config.ts`, `package.json`, and both element managers are written serially after their earlier owners (U7 :679, U9 :714, U4 :628, U10 :726); no parallel unit shares a U17 file.
- The Goals bullet (PROPOSAL.md:18), rulings 26 and 27 (:512-513), the WebMCP status rows (:565-569, mcp's `executeTool` resolves `unknown` per ../mcp/src/browser/types.ts:351), the Limits rows (:827-829), and U12 and U13 (:754-755, :768) agree with the section and with U17's declared gaps.
- Prose: neither section carries a banned term from writing.md § Substitutions; the table and each list are introduced by a sentence; both headings are in sentence case; the fixed lifecycle vocabulary (names.md:218-232) is not misused.

# coherence: FAIL

## coh-1 [blocking]
CLAIM: U17 owns `tests/src/browser/conformance.test.ts` for the composition cases (PROPOSAL.md:802), and U13 runs `npm test` bare (PROPOSAL.md:768).
FAILING: The vendored policy law makes every `tests/{app,src}/**/*.test.ts` mirror a module: `tests/setupPolicy.ts:270` (POLICY_TEST_GLOB), `:451` (only `integration.test.ts` is exempt), `:2635`; `tests/policy.test.ts:758` runs `inspectPolicyWorkspace(process.cwd())`, which includes `inspectPolicyMirrors` (../scaffold/tests/setupPolicy.ts:481-500). No `src/browser/conformance.ts` exists or is planned, so after U17 lands `npm run test:policy` reports `mirror: module test requires one matching module: src/browser/conformance.ts` and U13's `npm test` reddens. (U9's `tests/src/browser/source.test.ts` at PROPOSAL.md:713 fails the same law.)
CITE: PROPOSAL.md:802; tests/setupPolicy.ts:270,451,2635; tests/policy.test.ts:758
FIX: Put the composition cases in `tests/src/browser/factories.test.ts`, the mirror of `src/browser/factories.ts` that owns `createDocumentToolset`, and change the U17 Owns entry to that path.

## coh-2 [blocking]
CLAIM: U17.5: publishing `toolset.native` from `createDocumentToolset` "registers exactly the seven generic descriptors" (PROPOSAL.md:809).
FAILING: The DOM toolset advertises five tools, not seven: "7 tools on CDP, 5 in the DOM placement" (PROPOSAL.md:169) and U10.4 "The DOM toolset lists exactly `look`, `read`, `click`, `type`, and `wait`" (PROPOSAL.md:732); seven is the CDP count (PROPOSAL.md:682). An executor asserting seven under the Playwright provider fails.
CITE: PROPOSAL.md:809 against PROPOSAL.md:169,732
FIX: Replace "the seven generic descriptors" with "the five generic descriptors the DOM toolset advertises".

## coh-3 [required]
CLAIM: U17.5: the absence path asserts `bridge !== undefined` equals `'modelContext' in document` "so a host that ships the registry reddens rather than skipping" (PROPOSAL.md:809).
FAILING: The proposal's own evidence says Chrome's intent locates the registry on `Navigator.modelContext` (PROPOSAL.md:566; Limits PROPOSAL.md:828). On such a Chrome, `createModelContext` returns `undefined` because `isWebMCPDocument` reads only `document.modelContext` (../mcp/src/browser/factories.ts:459, ../mcp/src/browser/validators.ts:59-61), `'modelContext' in document` is false, the equality holds, and the `runIf` block skips silently; nothing reddens.
CITE: PROPOSAL.md:809; PROPOSAL.md:566,826,828; ../mcp/src/browser/validators.ts:59-61
FIX: Add to the absence path `expect('modelContext' in navigator).toBe(false)`, so a Navigator-located registry reddens and forces the ruling the first Limits row (PROPOSAL.md:826) waits for.

## coh-4 [required]
CLAIM: U17.2: "every property of the mirror's `Tool`, `Annotation`, and `RemovedTool` types ... is one `parseBrowserTool` and `parseBrowserInvocationResult` name" (PROPOSAL.md:806).
FAILING: The mirror's `Tool` carries `stackTrace?: Runtime.StackTrace` (tmp/units/browser_protocol.json:30933; tmp/units/webmcp-cdp-domain.md:11-13), and `BrowserTool` (PROPOSAL.md:329-336) declares `name`, `description`, `schema`, `annotation`, `frame`, `node` and no member for it, so the row reddens on `stackTrace` as written and the executor has no ruling to apply.
CITE: PROPOSAL.md:806; tmp/units/browser_protocol.json:30933; PROPOSAL.md:329-336
FIX: Rule `stackTrace` as exclude in the domain row table (a registration stack trace serves a debugging human) and phrase the row as "is one parser name or one excluded row".

## coh-5 [required]
CLAIM: U17.3 lists the name rule (1 to 128 code points of ASCII alphanumerics, `_`, `-`, `.`) among the "IDL rows" read from the mirror, and the IDL mirror is "the `ModelContext` WebIDL blocks of `index.bs`" (PROPOSAL.md:802,807; "the WebIDL block" at PROPOSAL.md:61).
FAILING: The name rule is draft prose, not WebIDL: the reading records it as the sentence "must be between 1 and 128, inclusive, and only consist of ASCII alphanumeric code points" (tmp/units/webmcp-read-surface.md:23), so a mirror scoped to the WebIDL blocks holds no coordinate for the row, and the row cannot be compared against fetched bytes.
CITE: PROPOSAL.md:802,807,61; tmp/units/webmcp-read-surface.md:23
FIX: Widen the IDL mirror's cut to include the name-validation paragraph verbatim (and say so at PROPOSAL.md:61 and :802), or move the name rule out of "IDL rows" into a row pinned to that paragraph.

## coh-6 [required]
CLAIM: "Units run in the order given; a unit starts when its dependencies are accepted" (PROPOSAL.md:577) with U17 listed last (PROPOSAL.md:797) and U12 depending on U17 (PROPOSAL.md:755).
FAILING: Following the listed order, U12 (PROPOSAL.md:749) is reached before U17 has started, and U13 -> U12, U14 -> U13, U16 -> U14 (PROPOSAL.md:764,777,792), so the executor blocks at U12 with no rule saying U17 jumps the order; the sentence names every other out-of-order case (U1/U8, U3/U6, U9-U10) and not this one.
CITE: PROPOSAL.md:577,755,797
FIX: Add to PROPOSAL.md:577 "and U17 runs after U10 and before U12" (or place U17 before U12 in the listing).

## coh-7 [required]
CLAIM: U10.5: "publishing `native` through an IDL-faithful registry double leaves the double's own registrations untouched" (PROPOSAL.md:733).
FAILING: The only double this package can use is `tests/fixtures/modelContext.ts`, which U17 owns (PROPOSAL.md:802) and U17 depends on U10 (PROPOSAL.md:803); mcp's double is not published (`files` is `dist/src` and `README.md`, ../mcp/package.json:22-25). U10's executor either writes a second double or cannot meet row 5, and the same clause is already U17.5 (PROPOSAL.md:809).
CITE: PROPOSAL.md:733,802,803; ../mcp/package.json:22-25
FIX: Delete the publish clause from U10.5 (U17.5 holds it), or move `tests/fixtures/modelContext.ts` into U10's Owns.

## coh-8 [required]
CLAIM: Adapter table row 3 gives "U4 and U10" as the proof of the `[tool=NAME]` mark (PROPOSAL.md:69).
FAILING: Neither U4's acceptance (PROPOSAL.md:631-641) nor U10's (PROPOSAL.md:729-736) asserts the mark; U4 depends on U2 and U3 only (PROPOSAL.md:629) and cannot read a registered tool's `backendNodeId` before U6; U17 owns both element-manager files for the marks (PROPOSAL.md:802) and U17.6 (PROPOSAL.md:810) is the only assertion, so the row's proof column points at units that prove nothing about it.
CITE: PROPOSAL.md:69,629,631-641,729-736,802,810
FIX: Change the row's proof to "U17 rows 4 and 6".

## coh-9 [required]
CLAIM: "Stay aligned": a changed byte reddens at module load, and "A drift is ruled, never patched around: the mirror is refreshed to the newer revision" (PROPOSAL.md:61), implementing the owner's "keeping up with it" (Goals PROPOSAL.md:18).
FAILING: The digest catches a local edit only; upstream drift never changes the vendored bytes, so nothing reddens for the case the owner named, and no sentence says when to refresh, from where, or how the cut is made: the domain was fetched from `raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json` at tip of tree with no commit recorded (tmp/units/webmcp-cdp-domain.md:3-5), the IDL from `.../webmachinelearning/webmcp/main/index.bs` with the commit unobtained (tmp/units/webmcp-read-surface.md:12,41), and a "slice" re-serialized by Node is a rewrite, which ../scaffold/.claude/rules/documentation.md:53 forbids and ../scaffold/.claude/rules/writing.md:30 does not exempt.
CITE: PROPOSAL.md:61,18; tmp/units/webmcp-cdp-domain.md:3-5; tmp/units/webmcp-read-surface.md:12,41; ../scaffold/.claude/rules/documentation.md:53
FIX: Add one sentence to "Stay aligned" naming the trigger (each version bump of this package, and whenever mcp's bridge reading date advances), the two raw URLs with the revision token taken from the commit, the cut (the verbatim line range of the `WebMCP` domain object and of the `ModelContext` IDL blocks, never re-serialized), and the place that records the revision (the guide's "Declared conformance gaps").

## coh-10 [required]
CLAIM: Exit criterion: "the conformance rows in U17 are green against mirrors whose revisions the guide names" (PROPOSAL.md:815).
FAILING: No unit produces that guide text: U12's Owns names the adapter table and the gaps section with each exclusion's closer (PROPOSAL.md:754) and its acceptance (PROPOSAL.md:757-760) never checks a revision, and U17's Owns (PROPOSAL.md:802) touches no guide, so the criterion can fail after every unit is accepted.
CITE: PROPOSAL.md:815,754,757-760,802
FIX: Add "the two mirror revisions and digests" to U12's "Declared conformance gaps" ownership and an acceptance line: a Grep of the guide for both revision tokens matches.

## coh-11 [optional]
CLAIM: "as mcp's guide does for its bridge (`../mcp/guides/mcp.md:4901`)" for naming each exclusion with its closer (PROPOSAL.md:61).
FAILING: Line 4901 is the "## WebMCP parity" heading, whose rows end implement, retain, or exclude with a source; the bridge's closer is named in "## Declared conformance gaps" (../mcp/guides/mcp.md:4932) at ../mcp/guides/mcp.md:5295 ("**Closer:** a browser that ships the registry").
CITE: PROPOSAL.md:61; ../mcp/guides/mcp.md:4901,4932,5295
FIX: Cite `:4901` for the rulings and `:5295` for the closer.

## coh-12 [optional]
CLAIM: "Two adapters carry WebMCP tools into that model, one per direction the specification defines" (PROPOSAL.md:60).
FAILING: The specification defines neither the `WebMCP` protocol domain nor an outside-the-browser direction; the domain's source is the devtools-protocol repository (tmp/units/webmcp-cdp-domain.md:3-4), and the two rows are placements (outside, inside), not directions the draft names.
CITE: PROPOSAL.md:60; tmp/units/webmcp-cdp-domain.md:3-4
FIX: Write "one per side of the browser boundary".

## coh-13 [optional]
CLAIM: U17.4 maps `autosubmit` to the `[tool=NAME]` mark (PROPOSAL.md:808).
FAILING: Nothing defines what `autosubmit` renders: the format fence shows the bare mark (PROPOSAL.md:199) and the adoption policy keys the mark on `node` alone (PROPOSAL.md:389), so the executor has no expected string to assert.
CITE: PROPOSAL.md:808,199,389
FIX: Drop `autosubmit` from the row, or define its rendering (for example `[tool=NAME autosubmit]`) under "Result formats".

## coh-14 [optional]
CLAIM: A page tool is skipped "because the provider charset excludes" a period (Limits PROPOSAL.md:829; U17.4 PROPOSAL.md:808).
FAILING: The declared gap is narrower than the skip: the WebMCP rule allows 1 to 128 code points (PROPOSAL.md:565) against the charset's `{1,64}` (PROPOSAL.md:389), so a 65-to-128-character name is skipped too, and the provider charset `^[A-Za-z0-9_-]{1,64}$` carries no source citation anywhere in the proposal (no hit in /home/user/tool/src or /home/user/orkestrel/ollama/src).
CITE: PROPOSAL.md:829,808,565,389
FIX: Name the length bound in the gap and cite the provider document behind the charset.

## held
- `tests/conformance.test.ts` as the fixed drift-proof home: ../scaffold/.claude/rules/tests.md:56; the scaffold requires the `conformance` project and `npm run test:conformance` in `npm test` when that file exists (../scaffold/tests/config.test.ts:201-209,744-751), so U13's gate list matches.
- The mcp precedent: digest-pinned, revision-dated mirror (../mcp/tests/setupConformance.ts:165-174; ../mcp/tests/mirrors/ext-tasks-2026-07-28-schema.json:1-4), read at module load so a changed byte throws before a row runs (../mcp/tests/setupConformance.ts:252-263); the conformance project runs with the browser disabled (tmp/units/webmcp-read-bridge.md:78).
- Vendored mirrors are fetched bytes exempt from the prose rules (../scaffold/.claude/rules/writing.md:30), and `tests/mirrors/` is already in the formatter ignore list (.prettierignore, vendored from ../scaffold/.prettierignore), so `format:check` cannot reshape a digest-pinned file.
- mcp 0.0.33's bridge declares three hints and `toolchange` only, read 2026-09-15 (../mcp/src/browser/types.ts:218-233; ../mcp/src/browser/constants.ts:22); `executeTool` resolves `unknown` (../mcp/src/browser/types.ts:351); no `toolactivated`, `toolcancel`, or `debugging` anywhere in mcp (tmp/units/webmcp-read-bridge.md:32).
- No identifier in ../mcp/src ends in `Adapter` or `Bridge` (grep over ../mcp/src returns nothing); mcp names its adapters in prose (`MCPLegacyClientTransport`, the duplex transports).
- `createPageServer` and `createScopeServer` exist (../mcp/src/browser/factories.ts:187,381); `createModelContext` publishes and adopts with the hint triple each way (../mcp/guides/mcp.md:4913-4920); `describe.runIf(isWebMCPDocument(document))` and the absence-path precedent exist (../mcp/tests/src/browser/ModelContext.test.ts:1170; ../mcp/tests/src/browser/factories.test.ts:1337); the fixture header claims the boundary-stub exemption (../mcp/tests/fixtures/modelContext.ts:1-16).
- Protocol citations hold: `Annotation` at tmp/units/browser_protocol.json:30847-30883, `inputSchema` optional at :30910-30913, `enable` fires `toolsAdded` at :30961, the response precedes tool events at :30990, `output` is untrusted at :31078; the four commands and four events exist (tmp/units/webmcp-cdp-domain.md:16-35).
- "Specification draft of 2026-09-29": the fetched page stamps itself "Draft Community Group Report, 29 September 2026" (tmp/units/webmcp-read-bridge.md:33); the draft declares `ontoolactivated`, `ontoolcancel`, `ToolActivatedEvent`, `ToolCancelEvent`, and `debugging` (tmp/units/webmcp-read-surface.md:15-20); the repository lists no test directory (tmp/units/webmcp-read-surface.md:34); Chrome milestones and the `Navigator.modelContext` naming (tmp/units/webmcp-research-report.md:83-101).
- Internal consistency: the adoption policy's skips (reserved, held, charset, optional `what`, `debugging`; PROPOSAL.md:389), U7.5, U17.4, R21, R26, R27, the "Two readings" paragraph, and Limits rows 827-829 agree; the Goals bullet, D3, the Dependencies row for `@orkestrel/mcp` (PROPOSAL.md:473), and U9's devDependencies (D2, D3) cover what U17 imports; U17.7's Grep matches the names rule at PROPOSAL.md:475.
- Every list and table in the two parts is introduced by a sentence in the live PROPOSAL.md (:57 for the list, :63 for the table); the extracted tmp/units/relation-section.md is stale (its table sits inside the list), and the live file is the one audited.
- Intent: no sentence in the two parts reads as wrapping WebMCP; the fleet-native paths (`@orkestrel/tool` model, `createPageServer`/`createScopeServer`, the registry-free vocabulary proven on Chromium 141 by P1 and P15) exist beside each WebMCP path.
