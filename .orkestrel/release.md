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

## Remaining

- W5 `@orkestrel/ollama` 0.0.20: the visit re-pins contract `^0.0.19`, tool `^0.0.18`, and browser `^0.0.19` (development); unit O1 lands; bump from 0.0.19; `prepublishOnly`; release commit; upload.
- W6 `@orkestrel/scaffold` 0.0.83: the visit, scaffold item 40 (`npm install` for the `@orkestrel/browser` `^0.0.19` development range, then the `catalog` verb after W5 so the table reads every wave release), bump from 0.0.82, `prepublishOnly`, release commit, upload.

## Readings

- The registry lists a version in the packument at once and serves its tarball minutes later: contract 0.0.19 published at 16:45:24Z and its tarball answered 200 at 16:50:48Z. Before a dependent's install, poll the tarball URL until it answers 200; a distribution proof that installs the packed archive earlier fails `E404`.
