# U17 report

Commit: ef10a1c (ledger-only entry atop 8686f68; per coordinator, expectation met). Tree clean. Version 0.0.19 in package.json and src/core/constants.ts:180.
Logs: /home/user/browser/tmp/codex/u17/

| Command | Exit | Count |
|---|---|---|
| git status --short | 0 | empty |
| package.json version | 0 | 0.0.19 |
| grep constants.ts | 0 | line 180 |
| prepublishOnly (whole chain) | 0 | see below |
| format:check, lint:check, check, build | 0 | - |
| test:src | 0 | 1249 passed, 1 skipped |
| test:policy | 0 | 114 passed, 1 skipped |
| test:config | 0 | 172 passed, 1 skipped |
| test:setup | 0 | 145 passed |
| test:setup:browser | 0 | 21 passed |
| test:guides | 0 | 207 passed |
| test:conformance | 0 | 69 passed |
| test:distribution --mode release | 0 | 11 passed, 4 skipped |
| test:service | 0 | 53 passed, 1 skipped |
| test:src:browser | 0 | 225 passed, 1 skipped |
| test:setup:browser (rerun) | 0 | 21 passed |
| test:guides (rerun) | 0 | 207 passed |
| test:probe | 1 | 4 failed, 22 passed (26) |
| compare.ts | 3 | expected |
| pins.ts | 0 | 0 hits |
| grep setInterval src | 1 | none |
| grep "setTimeout(" src \| wc -l | 0 | 21 |

## Failure: test:probe (not part of prepublishOnly)
Probes under tmp/probes/, failing:
- tmp/probes/cdp-native.test.ts P7 and P8: `TypeError: page.content is not a function`
- tmp/probes/cdp-native-2.test.ts P13: `TypeError: page.content is not a function`
- tmp/probes/cdp-native-4.test.ts P19: `AssertionError: expected 2 to be 1`
- tmp/probes/c6/c6-attach.test.ts, c6-navigation.test.ts, c7/c7-parent.test.ts: `Cannot find module '../../tests/setupServer.js'` (ERR_MODULE_NOT_FOUND; file-level failures)

## compare.ts (exit 3)
```
compare: @orkestrel/browser@0.0.18 — 8 published file(s), 2 added, 0 removed, 8 changed
compare: added src/browser/index.d.ts
compare: added src/browser/index.js
compare: changed src/core/index.cjs
compare: changed src/core/index.d.cts
compare: changed src/core/index.d.ts
compare: changed src/core/index.js
compare: changed src/server/index.cjs
compare: changed src/server/index.d.cts
compare: changed src/server/index.d.ts
compare: changed src/server/index.js
```
## pins.ts (exit 0)
```
pins: 0 hit(s) for 0.0.18 under src, tests, guides
```

Verdict: release gates green (prepublishOnly exit 0); only test:probe failed (exit 1, stale scratch probes in tmp/probes).
