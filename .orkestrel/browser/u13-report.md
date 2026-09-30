# U13: the gates read bare

Sonnet `verifier`, read-only, on `e64f814` (branch `ccr-d15a48b1-yyyll6`), every command bare from the checkout root, one after another, on 2026-09-30. Overall: GREEN.

| # | Command | Exit | Counts | Duration |
| --- | --- | --- | --- | --- |
| 1 | `npm run format:check` | 0 | 193 files correct | 6 933 ms |
| 2 | `npm run lint:check` | 0 | no output | |
| 3 | `npm run check` | 0 | tsc and the core, server, and browser `check:src` clean | |
| 4 | `npm run build` | 0 | core, server, and browser built | |
| 5 | `npm test` | 0 | the projects below | |
| 6 | `npm run test:distribution -- --mode release` | 0 | 11 passed, 4 skipped (15) | 39.29 s |
| 7 | `npm run test:service` | 0 | 48 passed, 1 skipped (49) | 79.24 s |
| 8 | `npm run test:src:browser` | 0 | 220 passed, 1 skipped (221) | 27.01 s |
| 9 | `npm run test:setup:browser` | 0 | 21 passed (21) | 16.63 s |

The `npm test` projects: `test:src` 1088 passed, 1 skipped (80.22 s); `test:policy` 114 passed, 1 skipped (8.60 s); `test:config` 172 passed, 1 skipped (9.63 s); `test:setup` 122 passed (19.00 s); `test:setup:browser` 21 passed (16.71 s); `test:guides` 199 passed (2.94 s); `test:conformance` 69 passed (1.72 s).

Commands 3 and 4 print a note that the project uses TypeScript 6.0.3, newer than the 5.9.3 API Extractor bundles; the exit code is unaffected (a note for the publish wave).

10. `grep -rn "setInterval" src` matches nothing.
11. `grep -rn "setTimeout(" src` lists 19 sites: `server/Browser.ts:441`, `server/Browser.ts:1108` (the process-group drain loop, `setTimeout(resolve, Math.min(BROWSER_DRAIN_INTERVAL_MS, remaining))`, the one condition-testing loop), `server/transports/WebSocketCDPTransport.ts:131`, `server/helpers.ts:429`, `browser/BrowserDOMWait.ts:69`, `browser/transports/SocketCDPTransport.ts:107`, `core/BrowserTracing.ts:116`, `core/BrowserPage.ts:1062`, `core/BrowserPage.ts:1796`, `core/CDPClient.ts:138`, `core/BrowserToolset.ts:857`, `core/BrowserNavigationManager.ts:67`, `core/BrowserKeyboard.ts:74` and `:88` and `core/BrowserMouse.ts:88` and `:107` (`setTimeout(resolve, options.delay)`, caller-requested input delays), `core/BrowserRegistry.ts:157`, `core/BrowserClock.ts:86`, `core/compilers.ts:47`. The policy allowlist in `tests/setupPolicy.ts` pins every site by path and declaration (`test:policy` green).
