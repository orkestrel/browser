# Release wave: the contract cascade and the journeys release

Run the wave with the `orkestrel-publish` skill: the visit (`wave.ts --visit`), the bump ruling, the layer preparation, then `window.ts --publish DIRS --otp CODE` with a code the owner sends at the moment the layer is ready. The account answers with an authenticator code; a code that arrives near the end of its 30 seconds is refused `EOTP`, so ask for one just after it rolls over and never retry on a refused code.

## Published

| Window | Package | Version | Release commit | Bump ruling |
| --- | --- | --- | --- | --- |
| W1 | `@orkestrel/contract` | 0.0.19 | `8bd3382` | dist moved (`schemaToShape` reads a type array) |
| W2 | `@orkestrel/html` | 0.0.12 | `f3dfc68` | contract range moved |
| W2 | `@orkestrel/tool` | 0.0.18 | `a212f30` | contract range moved |
| W3 | `@orkestrel/markdown` | 0.0.17 | `5a61e00` | contract and html ranges moved |
| W3 | `@orkestrel/mcp` | 0.0.34 | `528d466` | dist moved and contract and tool ranges moved; the distribution proof's overrides moved with them |
| W4 | `@orkestrel/browser` | 0.0.19 | `cd153f0` | dist moved and every runtime range moved; the manifest carried 0.0.19 from the campaign |
| W5 | `@orkestrel/ollama` | 0.0.20 | `f2efe02` | contract, tool, and browser ranges moved; the store proof's turn lever |
| SV | `@orkestrel/server` | 0.0.22 | `28e678e` | dist moved (`stop()` ends a connection that never carried an exchange) |
| SV | `@orkestrel/mcp` | 0.0.35 | `4a05c2b` | server range moved |
| SV | `@orkestrel/browser` | 0.0.20 | `1b1b3aa` | server and mcp ranges moved |
| W6 | `@orkestrel/scaffold` | 0.0.83 | `d131a26` | dist moved (`@orkestrel/browser` joins a rendering blueprint) and every catalog range moved |

## Remaining

- S43 `@orkestrel/scaffold` 0.0.84: the cycle guard lands; the visit with `--prior 0.0.83`; bump; `prepublishOnly` with npm 11 on `PATH` (a generated workspace declares `devEngines` npm `>=11.6.0`); release commit; upload. Then mcp's propagation visit reruns and every session repository re-pins `^0.0.84`.

## Readings

- The registry lists a version in the packument at once and serves its tarball minutes later: contract 0.0.19 published at 16:45:24Z and its tarball answered 200 at 16:50:48Z. Before a dependent's install, poll the tarball URL until it answers 200; a distribution proof that installs the packed archive earlier fails `E404`.
- A distribution proof that installs a scaffold-generated workspace needs npm 11.6.0 or later; the session host runs npm 10.9.7, so prepend `/home/user/.wave/npm11/node_modules/.bin` to `PATH`. After a publish, set `npm_config_prefer_online=true` so a cached packument does not answer `notarget`.
