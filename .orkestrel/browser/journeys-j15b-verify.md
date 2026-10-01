# J15b report (HEAD d25cc57, branch ccr-d15a48b1-yyyll6)
| Command | Exit | Count line |
|---|---|---|
| git status --short | 0 | empty (tmp/, dist/, node_modules/ ignored) |
| npx oxfmt --check | 0 | 226 files correct |
| npx oxlint --config .oxlintrc.json --deny-warnings | 0 | no output |
| npm run check | 0 | tsc clean |
| npm run build | 0 | built |
| npm test | 0 | src 70f/1649p+1s; bin 5; policy 114p+1s; config 172p+1s; setup 165; setup:browser 21; guides 248; conformance 69 |
| test:src:core | 0 | 50 files, 1171 passed |
| test:src:server | 0 | 11 files, 243 passed |
| test:src:browser | 0 | 9 files, 235 passed, 1 skipped |
| test:distribution | 0 | 1 file, 19 passed, 4 skipped |
| test:service | 0 | 5 files, 98 passed, 1 skipped |
| fence compare | 0 | equal byte for byte (design lines 287-304 vs BROWSER_JOURNEY_MODULE tests/setup.ts 3662-3679) |
| compare.js vs @orkestrel/browser@0.0.18 | 3 | 8 published files, 3 added, 0 removed, 8 changed |
Failures: none. Compare.js exit 3 = differences from published (listed: added bin/main.js, src/browser/index.d.ts, index.js; changed src/core and src/server index.{cjs,d.cts,d.ts,js}).
