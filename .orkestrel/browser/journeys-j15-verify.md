J15 report, HEAD d4d060e, branch ccr-d15a48b1-yyyll6
| command | exit | count line |
|---|---|---|
| git status --short | 0 | empty (no tracked changes; tmp/ not listed) |
| npx oxfmt --check | 0 | 226 files correct format |
| npx oxlint --config .oxlintrc.json --deny-warnings | 0 | no output |
| npm run check | 0 | tsc root + core/server/browser/bin clean |
| npm run build | 0 | core, server, browser, bin built |
| npm test | 0 | src(core+server+browser) 70 files, 1587 passed 1 skipped; bin 5; policy 114 passed 1 skipped; config 172 passed 1 skipped; setup 165; setup:browser 21; guides 248; conformance 69 |
| test:src:core | 0 | 50 files, 1109 passed |
| test:src:server | 0 | 11 files, 243 passed |
| test:src:browser | 0 | 9 files, 235 passed 1 skipped |
| test:distribution | 0 | 1 file, 19 passed 4 skipped |
| test:service | 0 | 5 files, 98 passed 1 skipped |
| compare.js --package @orkestrel/browser | 3 | vs 0.0.18: 8 published, 3 added (bin/main.js, src/browser/index.d.ts, src/browser/index.js), 0 removed, 8 changed (src/core and src/server index .js/.cjs/.d.ts/.d.cts) |
Failures: none.
Fence: design §6 add-kettle block (lines 287-304) equals BROWSER_JOURNEY_MODULE (tests/setup.ts:3595-3612) byte for byte (1272 bytes each).
Git status: empty.
