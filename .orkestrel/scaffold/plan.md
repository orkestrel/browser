# Scaffold plan: release 0.0.84 and prove it on veneer

Scaffold 0.0.83 (`d131a26`) is on the registry and propagated to contract, html, tool, markdown, server, browser, and ollama. Its S38 condition plans `@orkestrel/browser` for mcp, which the browser package depends on at runtime, so mcp's overwrite refuses.

## Units

1. **S43, then the release.** Omit `@orkestrel/browser` from every workspace in the browser package's runtime dependency closure, held as a constant with a parity test against the installed tree; the visit with `--prior 0.0.83`; bump to 0.0.84; `prepublishOnly` with npm 11 on `PATH`; release commit; upload.
2. **Propagation.** Rerun mcp's visit against scaffold `^0.0.84`; re-pin `^0.0.84` and overwrite in contract, html, tool, markdown, server, browser, and ollama; no target bumps for a vendored-only change.
3. **V1, the propagation proof on `orkestrel/veneer`.** Visit veneer on `ccr-d15a48b1-yyyll6` under npm 11: re-pin scaffold `^0.0.84` and the wave's ranges, overwrite, and confirm the declare step adds `@orkestrel/browser` `^0.0.20` to its development dependencies and the vendored `quality.md` carries the `browse` rule and the serving lines; prove its gates; register `browse` outside the repository per that rule, serve the showcase with `vite preview`, record a journey through veneer's app, and replay it.
