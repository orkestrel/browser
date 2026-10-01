# J10 claims

The `browse` binary is implemented. `BrowserMCPServer` serves the 15-name vocabulary over stdio before Chromium starts, launches Chromium one time on the first call, forwards every call with its signal to the toolset's own manager, mirrors each page tool the toolset adopts as a dispatcher of its own, and tears down on the end of input, `SIGTERM`, and `SIGINT` with its profile removed. Every gate the brief names exits 0 on 2026-10-01 on Linux, running as root, with Chromium 141.0.7390.37. Each of the mutations `j10a` through `j10f` fails a named assertion. The unit is committed as 237f067; the follow-on (the `dialog` dispatcher, the mirror, and the after-destroy proof) is uncommitted on top of it.

## Changes

The following table lists each change of the whole unit by location.

| Location | Change |
| --- | --- |
| `src/server/BrowserMCPServer.ts:69` | Adds the class. The constructor (`:96`) registers one dispatcher per name of `BROWSER_TOOL_NAMES` and `BROWSER_JOURNEY_TOOL_NAMES`, `dialog` included, from `BROWSER_TOOL_COPY` on the server's own manager, and binds `createMCPServer` under `createMCPLegacy` to `createStdioServer`. |
| `src/server/BrowserMCPServer.ts:131` | `start()` arms the transport and listens for the end of input, `SIGINT`, and `SIGTERM`; after `destroy()` it rejects with `BROWSER_TOOLSET_ENDED`. |
| `src/server/BrowserMCPServer.ts:146` | `#destroy()` removes the listeners, stops the transport, removes every dispatcher, stops the mirror, and aborts the launch signal. It then destroys the toolset, which aborts the active replay, then the browser, then the profile. Each step runs even when an earlier one failed. |
| `src/server/BrowserMCPServer.ts:171` | `#execute` runs the dispatcher with the call's signal and caller, and answers a string value as one text block. |
| `src/server/BrowserMCPServer.ts:185` | `#forward` passes the arguments and the tool context unchanged to `toolset.tools.execute`. It returns that call's value, or rejects with its failure message. |
| `src/server/BrowserMCPServer.ts:199` | `#open` shares one launch among callers and forgets a rejected launch, so the next call retries. After `destroy()` began, it refuses with `BROWSER_TOOLSET_ENDED`. |
| `src/server/BrowserMCPServer.ts:211` | `#launch` creates the root and then `<root>/.profiles/<uuid>/` with a non-recursive `mkdir` (`:217`). It launches with `cdp.discover: false`, the abort signal, `headless`, `executable`, and, on Linux as root only, `--no-sandbox` (`:229`). It opens one page in an isolated context, constructs the toolset with `context` and the two file stores, and subscribes the mirror before `start()` (`:246`). A failure destroys what it built and removes the profile. |
| `src/server/BrowserMCPServer.ts:263` | `#mirror` adds a dispatcher with `toolToDefinition(tool)` for a tool the toolset's manager adds under a name outside the vocabulary. `#withdraw` (`:272`) removes that dispatcher, or re-mirrors a replacement still installed. `#clear` (`:279`) withdraws each tool of a `clear`. `#unmirror` (`:283`) detaches the three listeners. |
| `src/server/types.ts:349` | Adds `BrowserLaunchFunction`, and adds the `launch` and `stdio` options to `BrowserMCPServerOptions` (`:367`), with defaults in its remarks. |
| `src/server/factories.ts:107` | Adds `createBrowserMCPServer(options?)`. |
| `src/server/index.ts:8` | Exports `./BrowserMCPServer.js`. |
| `src/bin/main.ts:1` | Reads the four environment variables and starts the server. On a `BrowserError` it writes one line `browse: CODE: MESSAGE` and sets exit code 1. |
| `vite.config.ts:222` | Adds `srcBin` after `srcServer`, modeled on probe's, and registers it at `:421`. |
| `configs/src/vite.bin.config.ts:1` | Adds the shebang banner and rewrites `@src/core` and `@src/server` to `../src/core/index.js` and `../src/server/index.js`. |
| `configs/src/tsconfig.bin.json:1` | Adds the bin scope (`lib` `ESNext`, `types` `node`). |
| `package.json:23` | Adds `bin: { browse: dist/bin/main.js }`, `dist/bin` in `files` (`:28`), and the scripts `check:src:bin` (`:75`), `test:src:bin` (`:85`), and `build:src:bin` (`:94`). They are included in `check:src` (`:71`), `test` (`:79`), and `build:src` (`:90`). |
| `tests/src/server/BrowserMCPServer.test.ts:34` | Adds 13 tests over a launch double and an in-memory stdio pair. |
| `tests/src/bin/main.test.ts:26` | Adds 5 tests that spawn the built entry. |
| `tests/distribution.test.ts:1171` | Adds the packed binary's case, with `connectBrowse` at `:1129`. |
| `tests/distribution.test.ts:706` | Adds `readLocalDependencies`, which the consumer manifest applies as `overrides` at `:734` (deviation D3). |
| `tests/setupServer.ts:1777` | Adds `BrowserLaunchDouble` (`:1815`) and `BrowserLauncher` (`:1959`), whose `evaluation`, `released`, and `registry` handlers receive the launch's transport. Also adds `MCPStdioPair` (`:2005`) with its duplex `transport` for an `@orkestrel/mcp` client (`:2027`), `BROWSE_VOCABULARY` (`:2142`), `BrowseChild` (`:2171`), `BrowseSession` (`:2254`), and `openBrowseSession` (`:2269`) (deviation D2). |

Against 5a2e989, the commit before the unit, the numstat is:

- New files: `configs/src/tsconfig.bin.json` +18, `configs/src/vite.bin.config.ts` +22, `src/bin/main.ts` +34, `src/server/BrowserMCPServer.ts` +295, `tests/src/bin/main.test.ts` +145, `tests/src/server/BrowserMCPServer.test.ts` +590.
- Changed files: `package.json` +10 −3, `src/server/factories.ts` +25, `src/server/index.ts` +1, `src/server/types.ts` +21 −4, `tests/distribution.test.ts` +152 −2, `tests/setupServer.ts` +545 −1, `vite.config.ts` +41.

The follow-on alone, against 237f067, is `src/server/BrowserMCPServer.ts` +58 −8, `tests/setupServer.ts` +66 −29, and `tests/src/server/BrowserMCPServer.test.ts` +191 −1.

## Environment variables for J12

The bin reads these four variables, and an empty value counts as unset:

- `BROWSE_ROOT` sets the root, resolved against the working directory. Default: `tmp/browsers`.
- `BROWSE_HEADLESS` takes `true`, `false`, `1`, or `0`, parsed by `@orkestrel/contract`'s `parseBoolean`. Default: `true`.
- `BROWSE_EXECUTABLE` sets the Chromium path. Default: the browser `findSystemBrowser` finds.
- `BROWSE_READONLY` takes `true`, `false`, `1`, or `0`. Default: `false`.

Any other value for `BROWSE_HEADLESS` or `BROWSE_READONLY` exits 1 with one line, such as `browse: BROWSER_SERVER_ENVIRONMENT: BROWSE_HEADLESS must be true, false, 1, or 0, not "sometimes"`.

For the guide: the server launches Chromium with `--no-sandbox` only on Linux and only when it runs as root, because Chromium refuses to start as root with its sandbox on, so no launch that could run sandboxed loses its sandbox.

## Claims

1. **Vocabulary before launch.** `tools/list` answers `look`, `read`, `click`, `type`, `press`, `navigate`, `wait`, `dialog`, `tabs`, `switch`, `record`, `save`, `journeys`, `edit`, and `replay`, in that order. Each tool carries `BROWSER_TOOL_COPY`'s description and parameters, with its annotations projected through `toolAnnotationsToMCP`. No launch is recorded and no root is created. Proofs:
   - `lists the vocabulary with its copy before any launch` (mutation `j10f`).
   - The bin case `lists the vocabulary to the mcp stdio client with Chromium absent, then refuses after the client closes`.
   - The packed case.
2. **One launch.** Two first calls arrive in one chunk while the launch is parked, and they produce one launch with one `connect()`; both calls are answered. A failed launch answers both of its callers `The fixture refused the launch` as an error, destroys its browser, and removes its profile; the next call launches again. Proofs: `launches one time under two concurrent first calls` (mutation `j10a`) and `rejects every caller of a failed launch and launches again on the next call`.
3. **Profiles and no attachment.** Each launch receives `<root>/.profiles/<uuid>/`, which exists while the server runs. A second server in the same root receives a distinct profile, and `destroy()` removes both. Each launch carries `cdp: { discover: false }`, `headless`, and `executable` as configured. Proof: `gives a second server in the same root its own profile and never attaches` (mutation `j10b`).
4. **Forwarding with the signal.** Proof: `forwards each call and its signal to the toolset's manager and returns its result` (mutation `j10d`).
   - The `look` text equals what an independent toolset over an identical page returns.
   - An unadvertised argument gets the same refusal text as that toolset, with `isError` set.
   - `journeys` answers `BROWSER_JOURNEY_EMPTY_LISTING`, so `.profiles` is not listed.
   - When a pending `wait` is cancelled with `notifications/cancelled`, the page sends its release script `globalThis["__browserTextWait1"]?.()`. The cancelled request draws no answer, and `tabs` still answers after it.
5. **`dialog`.** A `click` on `e4` whose release is withheld meets a confirm dialog. The server answers `Clicked e4 button "Place order". A confirm dialog is open: "Delete the draft?"; call dialog.`. Then `dialog` with `accept: true` through the server answers `Accepted the confirm dialog "Delete the draft?".` followed by the view, and `Page.handleJavaScriptDialog` is sent one time. Proof: `answers a click that opens a dialog, then the dialog, through the server` (mutation `j10f`).
6. **Mirrored page tools.** Proof: `mirrors an adopted page tool, notifies a subscribed client, and removes it on withdrawal` (mutation `j10e`).
   - An `@orkestrel/mcp` client is bound to the in-memory pair and subscribed with `toolsListChanged`.
   - After `WebMCP.toolsAdded` names `search`, the client receives `notifications/tools/list_changed`. `tools/list` then answers the vocabulary followed by `search`, with the description `Search the catalog`.
   - A call to `search` reaches `WebMCP.invokeTool` with `toolName: 'search'` and the input unchanged.
   - After `WebMCP.toolsRemoved`, `search` leaves `tools/list`, the client receives a second `notifications/tools/list_changed`, and the list equals the vocabulary again.
7. **Teardown.** The end of input, `SIGTERM`, and `SIGINT` each destroy the browser and remove the profile. The signal listener counts return to their values from before `start()`, and the input has no `data` listener. After a signal, a request written to the input stays unread in its buffer and draws no answer. `start()` after `destroy()` rejects with `BROWSER_TOOLSET_ENDED`. Proofs: the three `stops admission and removes the profile` tests (mutation `j10b`) and `refuses to start again after destroy`.
8. **A call that reaches the server after `destroy()` began.** A call has been read and is being dispatched when `destroy()` begins. It launches nothing, creates no root, and draws no answer. Proof: `launches nothing for a call that reaches its dispatcher after destroy began`. Three layers each keep such a call from launching, and the controls `d7`, `d7-removal`, `d7-both`, `d7-check-alone`, and `d7-all` separate them (see the mutation table):
   - stopping the transport aborts the call's signal, so the tool manager refuses it before entry;
   - `destroy()` removes every dispatcher;
   - `#open` refuses with `BROWSER_TOOLSET_ENDED`.

   With only `#open`'s refusal left (`d7-check-alone`), the test passes, so the test reaches the dispatcher and the refusal keeps it from launching. With all three removed (`d7-all`), it fails with one launch.
9. **`readonly`.** With `readonly: true`, `record` answers `BROWSER_JOURNEY_READONLY_REFUSAL` as an error. With `readonly: false`, it answers `Recording check-cart; …`. Proof: `passes readonly through to the journey tools`.
10. **Row 21.** The toolset constructs and starts on a manager it owns, so its `start()` meets no foreign name. When the dispatchers sit on the toolset's manager (mutation `j10c`), construction refuses with `The tool manager already holds a tool named record, a name the browser toolset reserves`.
11. **The bin.** Proofs: the five tests in `tests/src/bin/main.test.ts`.
    - The manifest's `bin.browse` resolves to `dist/bin/main.js`, whose first line is `#!/usr/bin/env node`.
    - Spawned in a scratch directory with a missing executable, it answers discovery and answers `look` with an error, and `<cwd>/tmp/browsers/.profiles` is left empty. At the end of its input it exits `{ code: 0, signal: null }` with an empty standard error.
    - On `SIGTERM` it exits `{ code: 0, signal: null }`.
    - A malformed flag exits 1 with the one line given in the preceding section.
    - After the mcp stdio client closes, which signals the child, `client.call` is refused with `MCP client is not connected, so 'tools/call' was not issued`.
12. **Claim 15 on the packed artifact.** Proof: `packed browse binary > lists the vocabulary without Chromium, then records, saves, lists, edits, and replays a journey [requires the registry and a browser]`, which passed in 3.4 s in the verbose run.
    - The packed tarball installs into a throwaway consumer.
    - The mcp package's stdio client spawns `node node_modules/@orkestrel/browser/dist/bin/main.js` from the consumer's directory. With a missing executable, it lists the vocabulary and creates no root.
    - With the pinned Chromium 141.0.7390.37, it navigates to the fixture's `/late` page and records `reveal-code`: a click on `Reveal` and a wait for `Confirmation code 4417`.
    - It saves the journey as `Saved reveal-code with 2 steps.` and lists it as exactly `reveal-code "Reveals the confirmation code"`, `s1 click button "Reveal"`, and `s2 wait "Confirmation code 4417"`.
    - It edits the journey by adding `s3 navigate URL` before `s1`, and replays it as `Replayed reveal-code: 3 of 3 steps.`.
    - One `run.json` lands under the consumer's `tmp/browsers/reveal-code/runs/<id>/`, and the profile directory is empty after the client closes.

No `prove` tool is registered in this session, so no claim has a closing line (`no receipt`). The tests and the mutations are the evidence.

## Mutations

`tmp/codex/j10-mutations/run.ts` applies each mutation as one or more replacements in `src/server/BrowserMCPServer.ts` and runs `node node_modules/vitest/vitest.mjs run --config vite.config.ts --no-cache --reporter=verbose --project src:server tests/src/server/BrowserMCPServer.test.ts`. It then restores the source file and compares it with `original.snapshot`; the final run printed `restored true`. The `.mutant`, `.log`, and `.exit` files hold each mutated copy, its output, and its exit code. The following table records the final run over the 13 tests.

| Mutation | Breaking edit | Named assertion and failure | Exit and counts |
| --- | --- | --- | --- |
| `j10a` | Deletes `if (current !== undefined) return current` in `#open`, so a second first call launches again | `launches one time under two concurrent first calls`: `expected [ BrowserLaunchDouble{}, …(1) ] to have a length of 1 but got 2`. The failed-launch, forwarding, `dialog`, and mirror tests also fail. | 1; 5 failed, 8 passed |
| `j10b` | Deletes the profile `rm` in `#destroy` | `stops admission and removes the profile on SIGTERM`: `Condition "the destroyed browser and the removed profile" did not hold within 3000ms`. The end-of-input, `SIGINT`, and second-server tests also fail. | 1; 4 failed, 9 passed |
| `j10c` | Passes `tools: this.#tools` to `createBrowserToolset`, which registers the dispatchers on the toolset's manager | `forwards each call and its signal…`: the `look` answer differs, because the launch rejects with `The tool manager already holds a tool named record, a name the browser toolset reserves`. | 1; 10 failed, 3 passed |
| `j10d` | Forwards `{ signal: new AbortController().signal }` in place of the call's context | `forwards each call and its signal…`: `Condition "the cancelled wait to release its page script" did not hold within 2000ms` | 1; 1 failed, 12 passed |
| `j10e` | `#withdraw` returns in place of removing the mirror of a withdrawn tool | `mirrors an adopted page tool…`: `Condition "the withdrawn page tool to leave tools/list" did not hold within 2000ms` | 1; 1 failed, 12 passed |
| `j10f` | Skips `dialog` when the constructor registers the dispatchers | `answers a click that opens a dialog, then the dialog, through the server`: the `dialog` answer is an error (`expected true to be false`). `lists the vocabulary…` and `mirrors an adopted page tool…` also fail on the list. | 1; 3 failed, 10 passed |
| `d7` (control) | Deletes `#open`'s refusal after `destroy()` | The after-destroy test passes; the transport stop and the dispatcher removal hold | 0; 13 passed |
| `d7-removal` (control) | Deletes the dispatcher removal in `#destroy` | Passes; the transport stop and `#open`'s refusal hold | 0; 13 passed |
| `d7-both` (control) | Deletes both of the preceding | Passes; the transport stop holds | 0; 13 passed |
| `d7-check-alone` (control) | Deletes the dispatcher removal and moves the transport stop to the end of `#destroy` | Passes; `#open`'s refusal alone keeps the call from launching | 0; 13 passed |
| `d7-all` (control) | Applies `d7-check-alone` and also deletes `#open`'s refusal | `launches nothing for a call that reaches its dispatcher after destroy began`: `expected [ BrowserLaunchDouble{} ] to strictly equal []` | 1; 1 failed, 12 passed |
| `stage` (control for D3, first round) | Writes the consumer manifest with `overrides: {}` | The stage throws `Installing the packed archive failed: … ENOENT … node_modules/@orkestrel/browser/tmp/tarballs/orkestrel-mcp-0.0.34.tgz` while loading | 1; 1 file failed, no tests |

## Validation

Every command ran from the worktree root on 2026-10-01 after the follow-on. I read each output whole.

| Command | Exit | Result |
| --- | --- | --- |
| `npx oxfmt --check` over the 13 touched files | 0 | All 13 formatted |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the 13 touched files | 0 | No diagnostics |
| `npm run check` | 0 | Root, `check:src:core`, `check:src:server`, `check:src:browser`, and `check:src:bin` pass |
| `npm run build` | 0 | `dist/bin/main.js` is 1.32 kB, built beside the three library builds |
| `npx vitest run --config vite.config.ts --project src:server tests/src/server/BrowserMCPServer.test.ts` | 0 | 13 passed |
| `npm run test:src:server` | 0 | 214 passed, 1 skipped, 11 files |
| `npm run test:src:bin` | 0 | 5 passed |
| `npm run test:distribution` | 0 | 13 passed, 4 skipped. The 4 skips are the existing `runIf` cases, and the packed binary's case passed. |
| `npm run test:policy` | 0 | 114 passed, 1 skipped |
| `npm run test:config` | 0 | 172 passed, 1 skipped |
| `npm run test:guides` (outside the brief, first round, for J12) | 1 | 12 failed, 195 passed. `documents every barrel export` lists this unit's `BrowserLaunchFunction`, `BrowserMCPServer`, `BrowserMCPServerInterface`, `BrowserMCPServerOptions`, and `createBrowserMCPServer`, beside the failures from J1–J9. |

## Deviations and notes

- **D1, shared file `src/server/types.ts` (stands).** The fake launcher and the in-memory stdio pair need seams, so `BrowserMCPServerOptions` gains two options. `launch` takes a `BrowserLaunchFunction` and defaults to `createBrowser`. `stdio` takes `StdioServerOptions` from `@orkestrel/mcp/server` and defaults to `process.stdin` and `process.stdout`. The patch is `tmp/units/journeys/j10-types.patch` (53 lines, against 5a2e989).
- **D2, scope note on `tests/setupServer.ts` (stands).** The fixtures the owned tests need are classes and setup data. The diff only adds code; its one removed line is the `./setup.js` import, which is widened. The import of `spawn` is aliased to `spawnProcess`, because J9's store suite declares a local `spawn`. `openBrowseSession` loads the server entry on demand, as J9's store proofs do. The follow-on generalizes the launcher's handlers to `evaluation`, `released`, and `registry`, adds the pair's duplex `transport`, and adds `dialog` to `BROWSE_VOCABULARY`. The patch is `tmp/units/journeys/j10-setupServer.patch` (569 lines, against 5a2e989).
- **D3, the distribution stage (stands).** The committed dependency move ships `"@orkestrel/mcp": "file:tmp/tarballs/orkestrel-mcp-0.0.34.tgz"`, which npm resolves inside the installed package, so the stage failed for every case (control `stage`). The consumer manifest now overrides each `file:` runtime dependency with the same file resolved against the workspace, and leaves registry ranges alone. The override stops applying when `^0.0.34` is restored. The patch is `tmp/units/journeys/j10-distribution.patch` (201 lines, against 5a2e989).
- **D4, `--no-sandbox` (ruled: stands).** The guide sentence for J12 is in § Environment variables for J12.
- **D5, text results (stands).** The mcp package renders a tool value as its JSON text, so the server's `execution` handler answers a string value as one text block. The mcp client reads the same string.
- **D6, `dialog` and adopted page tools (resolved by the amended design § 8).** Claims 5 and 6 cover this.
  - The `dialog` dispatcher is advertised at all times. While no dialog is open, the toolset's manager has no `dialog`, and a call is answered unchanged with that manager's `tool not found: dialog`.
  - Limit of `@orkestrel/mcp` 0.0.34: `notifications/tools/list_changed` reaches a modern client through `subscriptions/listen`. A dated-revision client, which connects through `initialize` (answered with `capabilities: { tools: {} }`), receives no notification and sees a mirrored tool on its next `tools/list`, because the guide states that `subscriptions/listen` is modern-only.
- **D7, the after-destroy refusal (resolved).** Claim 8 and the `d7` controls cover this. Through the server's surface, the layer a reachable call meets first is the transport stop, which aborts the call's signal. `#open`'s `BROWSER_TOOLSET_ENDED` refusal is the last layer, and its comment at `src/server/BrowserMCPServer.ts:197` states this. That refusal is never written to the wire, because the transport stops before it.
- **D8, the distribution case's working directory (stands).** The mcp stdio client spawns its child in `process.cwd()` and has no option for another directory (`StdioClientTransport.start` passes `workspace: process.cwd()` in 0.0.34). `connectBrowse` therefore makes the consumer the working directory until `connect()` settles, then restores it.
- **D9, signals in the server test (stands).** The `SIGTERM` and `SIGINT` cases send real signals to the forked Vitest worker, which survives because the server's listener is registered. Each case first asserts `isMainThread`, and each runs only where `COOPERATIVE_SIGTERM` holds.
- **D10, for J12 (stands).** The bin's code `BROWSER_SERVER_ENVIRONMENT` is not in § 11's table. `src:bin` joins `test` as `npm run test:src:bin`, after `npm run build`. The manifest keeps `"sideEffects": false`, which is not this unit's field.
- **Scope.** No commit, stash, reset, checkout, or index-wide git command was issued; the only git commands were read-only `log`, `status`, `diff`, and `check-ignore`. The probes were deleted. The mutation artifacts remain under the ignored `tmp/codex/j10-mutations/`.
