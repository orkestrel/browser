# Ollama plan: the store proof after the wave

`orkestrel/ollama` main holds the published-baseline tests; its `ccr-d15a48b1-yyyll6` branch (`f97df76`) adds `createLiveOllama`'s `context` and `turn` options. The store proof with its journey task depends on `@orkestrel/browser` 0.0.19 and waits on the wave as the local branch `ccr-d15a48b1-yyyll6-journeys` (`6d61a5a`, eight commits: U15 to U14f and the journey task) in the session's checkout at `/home/user/ollama`, with the manifest's tarball edges uncommitted (`@orkestrel/browser file:tmp/tarballs/orkestrel-browser-0.0.19.tgz`, the mcp override).

## Units, after browser 0.0.19 publishes

1. **Re-pin** (`builder`): `@orkestrel/browser ^0.0.19` in the manifest, the mcp override dropped, `npm install`, `node_modules/.vite` deleted, the `guides/browser.md` mirror refreshed from the published package (`scaffold repair` or the guide mirror command the repository uses).
2. **Land the journey history** (`builder`): rebase `ccr-d15a48b1-yyyll6-journeys` onto the pushed branch (the provider options are the one shared change) and push; run `npm run check`, the `setup` project, `npm run test:policy`, `npm run test:guides`, and `npm run test:service -- tests/service/browser.test.ts` once against the registry's 0.0.19; apply the ollama daemon's `num_ctx` 16 384 on every attempt, as the tests already do.
3. **The turn lever** (`opus`, the owner's ruling on 2026-10-01): the journey task's model keeps issuing `record` and `save` calls after a successful step instead of ending its turn, so after a bounded number of consecutive refusals of one tool the turn ends and the model answers. Decide first whether the bound lives in `@orkestrel/agent`'s loop as a policy (then it is that package's unit) or in the store proof's turn handling; land it; rerun the proof three times. The measurements to beat, from K4 on browser `1e9efad`: the five page tasks pass in every run; the journey task's record, save, list, and edit phases complete and the replay phase is lost to the loop (53, 20, and 34 refused calls after the save).

## Readings

The tool list costs 1 651 prompt tokens per turn on `qwen3.5:2b-q4_K_M`, 798 of them the journey tools and `type`'s `secret`, measured 2026-10-01 on browser `4a10abe`; the daemon's default 4 096-token window cuts a page task's third turn, and 16 384 holds the journey conversation. The ollama daemon on the session host is started by `ollama serve` and dies with the container.
