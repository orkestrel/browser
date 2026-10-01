# Ollama plan: the store proof on the wave, with the turn lever (W5)

The store-proof history (U15 through the journey task, eight commits) is rebased onto `f97df76` and branch `ccr-d15a48b1-yyyll6` sits at `df7ecd6`; the local `-journeys` branch is gone. The release visit re-pins contract `^0.0.19`, tool `^0.0.18`, and the development `@orkestrel/browser` `^0.0.19`, and drops the mcp override the tarball install needed.

## Units

1. **O1** (`opus`, brief `tmp/units/o1-brief.md` in the ollama checkout): retire `normalizeSchemaTypes` now that contract 0.0.19 converts a type array; end a turn after a bounded run of consecutive refusals of one tool, in the store proof's turn handling (the owner's ruling of 2026-10-01; `@orkestrel/agent` stays outside this release), pinned by a deterministic test; three live runs of `tests/service/browser.test.ts` against `qwen3.5:2b-q4_K_M` with `num_ctx` 16 384.
2. **The release (W5).** Bump from the registry's 0.0.19 to 0.0.20 for the runtime re-pin; `prepublishOnly`; release commit; upload.

## Readings

The measurements to beat, from K4 on browser `1e9efad`: the five page tasks pass in every run; the journey task completes record, save, list, and edit and loses the replay to the loop, with 53, 20, and 34 refused calls after the save. The tool list costs 1 651 prompt tokens per turn, 798 of them the journey tools and `type`'s `secret` (2026-10-01, browser `4a10abe`). The daemon on the session host runs `OLLAMA_MODELS=/opt/ollama/models ollama serve` and dies with the container.
