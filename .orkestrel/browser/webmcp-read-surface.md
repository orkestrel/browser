# surface

## summary

Question: pin the WebMCP surface for a dated conformance suite. WebFetch works but returns model-summarised text, so IDL blocks are as the tool returned them and unconfirmed against raw index.bs. The CDP domain is read directly from the vendored JSON. Not settled: spec date/commit, the version that introduced Puppeteer page.webmcp, the version that introduced the DevTools MCP tools, and any test suite.

## facts

- CDP WebMCP domain is experimental:true and depends on Runtime, Page, DOM. (tmp/units/browser_protocol.json:30839-30845 — "domain": "WebMCP", "experimental": true)
- CDP type Annotation (object), all optional booleans: readOnly, untrustedContent, consequential, debugging, autosubmit. autosubmit is 'If the declarative tool was declared with the autosubmit attribute.' (tmp/units/browser_protocol.json:30847-30883)
- CDP enum InvocationStatus (string): Completed, Canceled, Error. (tmp/units/browser_protocol.json:30884-30893)
- CDP type Tool: name string, description string, inputSchema? object, annotations? Annotation, frameId Page.FrameId (required), backendNodeId? DOM.BackendNodeId ('Optional node ID for declarative tools'), stackTrace? Runtime.StackTrace. No per-property experimental flags; only the domain is flagged. (tmp/units/browser_protocol.json:30894-30939)
- CDP type RemovedTool: name string, frameId Page.FrameId. (tmp/units/browser_protocol.json:30940-30956)
- CDP commands: enable (triggers toolsAdded for all currently registered tools); disable; invokeTool(frameId Page.FrameId, toolName string, input object) returns invocationId string ('Response is sent before tool events'); cancelInvocation(invocationId string). (tmp/units/browser_protocol.json:30958-31005)
- CDP events: toolsAdded(tools: Tool[]); toolsRemoved(tools: RemovedTool[]); toolInvoked(toolName string, frameId, invocationId string, input string); toolResponded(invocationId, status InvocationStatus, output? any, errorText? string, exception? Runtime.RemoteObject). toolInvoked.input is a string while invokeTool.input is an object. output is 'Missing if `status` is anything other than Completed' and flagged untrusted. (tmp/units/browser_protocol.json:31007-31094)
- Spec ModelContext IDL as returned by fetch: [Exposed=Window, SecureContext] interface ModelContext : EventTarget { Promise<undefined> registerTool(ModelContextTool tool, optional ModelContextRegisterToolOptions options = {}); Promise<sequence<RegisteredTool>> getTools(optional ModelContextGetToolOptions options = {}); Promise<DOMString> executeTool(RegisteredTool tool, optional object inputObject, optional ModelContextExecuteToolOptions options = {}); attribute EventHandler ontoolchange; attribute EventHandler ontoolactivated; attribute EventHandler ontoolcancel; }; (https://raw.githubusercontent.com/webmachinelearning/webmcp/main/index.bs (WebFetch summary, 2026-09-29))
- executeTool return type is Promise<DOMString> per the fetched IDL. The README sample's execute callback returns { content: [{type:'text', text}] }. (index.bs via WebFetch; tmp/units/webmcp-research-report.md:30-37)
- ModelContextTool dictionary: required DOMString name; USVString title; required DOMString description; object inputSchema; required ToolExecuteCallback execute; ToolAnnotations annotations. (index.bs via WebFetch)
- ToolAnnotations dictionary: boolean readOnlyHint=false; untrustedContentHint=false; consequentialHint=false; debugging=false. CDP Annotation names drop the Hint suffix and add autosubmit. (index.bs via WebFetch; tmp/units/browser_protocol.json:30847-30883)
- ToolExecuteCallbackOptions: required AbortSignal signal. (index.bs via WebFetch)
- Event interfaces: ToolActivatedEvent : Event and ToolCancelEvent : Event, each [Exposed=Window, SecureContext], constructor(DOMString type, optional <Type>Init eventInitDict = {}), readonly attribute DOMString toolName. (index.bs via WebFetch)
- RegisteredTool dictionary: required DOMString name; DOMString title; required DOMString description; object inputSchema; required Window window; required USVString origin; ToolAnnotations annotations. (index.bs via WebFetch)
- Name validation rule: length 1 to 128 inclusive; only ASCII alphanumeric, U+005F (_), U+002D (-), U+002E (.). (index.bs via WebFetch: "must be between 1 and 128, inclusive, and only consist of ASCII alphanumeric code points")
- Permissions-Policy feature 'tools', default allowlist 'self'; a site can disable with tools=(); README says cross-origin iframes use allow="tools". (index.bs via WebFetch: "policy-controlled feature 'tools', which has a default allowlist of 'self'"; tmp/units/webmcp-research-report.md:48-50)
- Registry location 1 (spec and README): Document. 'Each Document object has an associated ModelContext'; README calls document.modelContext.registerTool. (index.bs via WebFetch; tmp/units/webmcp-research-report.md:20)
- Registry location 2 (Chrome intent): Navigator. Intent to Experiment (blink-dev, 2026-05-15) names 'Navigator.modelContext (WebMCP)'. Unreconciled with Document in the sources read. (https://groups.google.com/a/chromium.org/g/blink-dev/c/gmYffo5WOE8/m/OJxuQRP3AAAJ (recorded at tmp/units/webmcp-research-report.md:90-96))
- Probe on this host's Chromium 141 read 'modelContext' in document and in navigator as false. (tmp/units/webmcp-cdp-domain.md:51-53)
- Declarative attributes: toolname, tooldescription, toolautosubmit (boolean), toolparamdescription; explainer under active development with TBD parts. SubmitEvent extension: readonly attribute boolean agentInvoked; undefined respondWith(Promise<any> agentResponse). (tmp/units/webmcp-research-report.md:58-76 (recorded; not re-fetched this session))
- Declarative open questions: toolactivated/toolcanceled for imperative tools; events target Window or form; outputSchema for declarative tools; integration with getTools()/executeTool(). (tmp/units/webmcp-research-report.md:78-81)
- Chrome milestones: DevTrial M146; origin trial M149-M156; shipping M157; approved 2026-05-18; TAG review pending. Flag needs Chrome 146.0.7672.0+. Origin trial blog 2026-06-09 says Chrome 149. (tmp/units/webmcp-research-report.md:83-101)
- Chrome DevTools MCP tools: list_webmcp_tools ('Lists all WebMCP tools the page exposes.') and execute_webmcp_tool (pageId, toolName, input JSON string). --categoryExperimentalWebmcp 'Requires Chrome 150+ with the following flag: --enable-features=WebMCP'. Package version read: 1.10.1. (tmp/units/webmcp-research-report.md:113-134,142-144)
- Puppeteer page.webmcp: packages/puppeteer-core/src/cdp/WebMCP.ts, execute(input,{signal}) and cancelInvocation. Release page shows puppeteer-core v25.9.0 (2026-08-25) with 'support canceling tool execution (#15365)'; this is the only dated release evidence and names cancel, not introduction. (tmp/units/webmcp-cdp-domain.md:38-43; https://github.com/puppeteer/puppeteer/releases (WebFetch 2026-09-29))
- Spec repo top level lists .github, assets, docs, .gitignore, .pr-preview.json, CONTRIBUTING.md, LICENSE.md, Makefile, README.md, declarative-api-explainer.md, implementation-status.md, index.bs, security-privacy-questionnaire.md, w3c.json. No tests, wpt or conformance directory appears. (https://github.com/webmachinelearning/webmcp/tree/main (WebFetch summary, 2026-09-29))

## gaps

- All IDL text is from a summarising fetch, not raw bytes; verify against a git-pinned index.bs before vendoring. Bodies of ModelContextRegisterToolOptions, ModelContextGetToolOptions, ModelContextExecuteToolOptions, ToolExecuteCallback, ToolActivatedEventInit, ToolCancelEventInit and any toolchange event were not returned.
- Spec date, Status and commit SHA not obtained (GitHub API commits returned 403).
- Document vs Navigator for modelContext unreconciled (spec says Document, Chrome intent says Navigator).
- No wpt/tests directory in the spec repo listing (from a summary); upstream web-platform-tests not checked for WebMCP tests.
- Version that introduced Puppeteer page.webmcp not found; v25.9.0 only evidences cancellation.
- Version that introduced Chrome DevTools MCP list_webmcp_tools/execute_webmcp_tool not found; the releases fetch (v1.10.1 to v1.2.0) did not mention them. Chrome 150+ requirement vs origin trial 149 mismatch remains.
- Declarative attributes and SubmitEvent extension not re-fetched this session.
- executeTool Promise<DOMString> vs README object result { content: [...] } unresolved.
- chromestatus feature 5117755740913664 body and security-privacy-questionnaire.md unread.
