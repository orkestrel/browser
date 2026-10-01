# G2 claims

The DOM refusal omits the option value, and the toolset redacts literal and JSON-quoted secret text before receipt splitting or truncation. The requested local gates pass. Browser execution and mutation g2a remain unproved because the sandbox refuses the browser runner's loopback listener.

## Changes and numbered claims

1. `src/browser/elements/BrowserDOMElement.ts:126` refuses with `Element REF has no such option.` The direct element assertion at `tests/src/browser/elements/BrowserDOMElement.test.ts:335` tests this defense independently of the toolset. The existing selection test also pins the wording at `tests/src/browser/elements/BrowserDOMElement.test.ts:440`. Runtime status: pending host execution.
2. `src/core/BrowserToolset.ts:575` replaces the secret's JSON-quoted form and literal text with `[redacted]` before bounding a message. `src/core/BrowserToolset.ts:545` sanitizes successful bodies and footers before splitting the action receipt. `src/core/BrowserToolset.ts:558` sanitizes refusals and interrupted receipts before clipping. A rewritten error retains the browser error code and context, so the saved error rethrown by direct tool execution has the sanitized message. `tests/src/core/BrowserToolset.test.ts:118` proves `perform`, managed execution, direct errors, and emitted action receipts with quotes, a newline, a backslash, repeated occurrences, and limits of 48 and 4096 characters. Status: passed; g2b kills its named assertion.
3. `src/core/BrowserToolset.ts:309` sanitizes results returned through the manager fallback, including pre-aborted `perform` calls. `src/core/BrowserToolset.ts:444` routes a direct secret invocation's abort through that boundary. `tests/src/core/BrowserToolset.test.ts:85` proves the abort reason is sanitized, no action is admitted, and ordinary non-secret refusal text remains intact. Status: passed.
4. `tests/src/core/BrowserToolset.test.ts:163` pins `Selected a secret` and removes secret text from a successful result and its emitted receipt even when the fixture publishes the value in the control's name. `tests/src/browser/elements/BrowserDOMElement.test.ts:391` pins the exact DOM receipt and checks that the option was actually selected. Status: core passed; DOM pending host execution. Page-published target metadata is outside the receipt claim.
5. `tests/src/core/BrowserReplay.test.ts:34` drives an upstream refusal through the real replay and recording memory store. It asserts a refused step, the forwarded secret flag, absent secret fragments in every recorded write and step event, the returned run, and its render, and equality with the persisted run. `tests/src/browser/elements/BrowserDOMElement.test.ts:335` drives the equivalent missing-option path through the real DOM element, `perform`, and replay. Status: core passed; DOM pending host execution.
6. `tests/setup.ts:4110` supplies the escaped secret and DOM select markup. `tests/setup.ts:4117` records writes while executing the real memory store. `tests/setup.ts:4132` supplies protocol-faithful select success and refusal responses. `tests/setup.test.ts:100` and `tests/setup.test.ts:131` prove persistence, rejection of an unopened run, and the fixture's unique select and response branches. Status: passed.

## Mutation evidence

Artifacts are under `tmp/codex/g2-mutations/`. Every mutated source was restored before the final gates.

| Mutation | Breaking change | Named assertion | Exit and count | Verdict |
| --- | --- | --- | --- | --- |
| g2a | Restore the DOM element's quoted missing value | `the element must not quote the missing option` in the DOM regression | Exit 1; no tests collected; `listen EPERM: operation not permitted 127.0.0.1` | Unproved; `g2a-direct.log` records the environmental failure |
| g2b | Disable the redaction guard in `#boundReceipt` | `perform must redact before clipping` | Exit 1; 1 failed, 146 skipped | Killed; `g2b-direct.log` records the named failure |

The focused regression command before the repair was `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts tests/src/core/BrowserReplay.test.ts -t 'redacts|upstream secret select refusal'`: exit 1, 3 failed and 172 skipped. The identical command immediately after the repair returned exit 0, 3 passed and 172 skipped. Subsequent added abort coverage is included in the final project run.

## Validation

Every command in this section used the prefix `env -C /home/user/browser/tmp/worktrees/g2`. The formatting and lint commands named these touched TypeScript files explicitly: `src/core/BrowserToolset.ts`, `src/browser/elements/BrowserDOMElement.ts`, `tests/setup.ts`, `tests/setup.test.ts`, `tests/src/core/BrowserToolset.test.ts`, `tests/src/core/BrowserReplay.test.ts`, and `tests/src/browser/elements/BrowserDOMElement.test.ts`.

| Command | Exit | Final result |
| --- | --- | --- |
| `npx oxfmt --check` over the listed files | 0 | 7 files formatted correctly |
| `npx oxlint --config .oxlintrc.json --deny-warnings` over the listed files | 0 | No diagnostics |
| `npm run check` | 0 | Root and core, server, browser, and bin TypeScript projects passed |
| `npx vitest run --config vite.config.ts --project src:core tests/src/core/BrowserToolset.test.ts tests/src/core/BrowserReplay.test.ts` | 0 | 2 files, 176 tests passed |
| `npm run test:src:core` | 0 | 50 files, 1,059 tests passed; 39.90 s |
| `npx vitest run --config vite.config.ts --project setup tests/setup.test.ts` | 0 | 1 file, 68 tests passed |
| `npm run test:policy` | 0 | 1 file, 114 passed, 1 existing conditional skip |
| `npx vitest run --config vite.config.ts --project src:browser tests/src/browser/elements/BrowserDOMElement.test.ts` | 1 | No tests collected; loopback listener refused with EPERM |
| `git diff --check` | 0 | No whitespace errors |

The policy skip at `tests/policy.test.ts:718` applies when the workspace does not author `.claude/rules/writing.md`; the installed scaffold owns that rule in this worktree.

## Scope notes and deviations

- `tests/setup.test.ts` is the only added owned path. The brief permits a test of an owned fixture. No other unit's files were changed. No commits, stashes, resets, checkouts, installs, or delegation occurred.
- Browser validation remains on the host as the brief anticipates. Expected: the restored DOM test passes and g2a fails its named assertion. Found: the sandbox refuses the runner's listener before collection. The tests and mutation driver are written; their browser runtime claims remain unproved. Run `env -C /home/user/browser/tmp/worktrees/g2 node tmp/codex/g2-mutations/run.ts g2a` on the host, then run the restored browser test command from the table.
- The mutation driver's nested `spawnSync` returned `EPERM`. Its `g2b.json` records that invocation failure. The harness then executed the mutation command directly; `g2b-direct.log` and `results.md` contain the valid evidence. The driver restores source in `finally`.
- No probe MCP tool was exposed in this session: **no receipt**. This report supplies the requested executable Vitest mutation evidence and does not claim a `prove` receipt.
- The initial brief and installed-contract reads omitted the required `env -C` prefix. Subsequent commands used it. The canonical `/home/user/scaffold/AGENTS.md` was also read; no contract conflict was found.

Acceptance remains with the host campaign. This report does not accept the unexecuted DOM claims or g2a.

## Host verification (orchestrator, 2026-10-01)

The browser project ran on the host after the lane returned. One expectation had the receipt's markers in the wrong order (`(programmatic) (untrusted event).` for the real `(programmatic). (untrusted event)`); the expectation at `tests/src/browser/elements/BrowserDOMElement.test.ts:410` follows the real receipt and the file passes 24 of 24. Mutation `g2a` on the host: exit 1, the named assertion `the element must not quote the missing option` fails with `Element e1 has no option "Zq7#…"` received, then restored. `npm run test:src:browser` in the worktree before the expectation fix: 1 failed, 234 passed, 1 skipped.
