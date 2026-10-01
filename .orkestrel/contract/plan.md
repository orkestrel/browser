# Contract plan: the schema reader and a JSON Schema type array

Scaffold's `ROADMAP.md` item 37 carries this work; the `orkestrel/contract` repository was outside the session that found it.

## Finding

`@orkestrel/contract` 0.0.18 reads a JSON Schema `type` array such as `['array', 'string']` as a shape that accepts any value. The reader is the `SchemaShaper` class in `dist/src/core/index.js`, which takes `isString(schema.type) ? schema.type : undefined` and matches no branch for an array, so `schemaToShape` returns an unconstrained shape. Measured 2026-10-01 against the installed 0.0.18 in `/home/user/browser` and `/home/user/ollama`: `edits: 3` passed a schema that declared `type: ['array', 'string']`.

## Units

1. Read a `type` array as the union of its members (the shape `anyOf` of one schema per type would produce), with a test per member count and a negative control that refuses a value outside the union; state the accepted forms in the contract guide.
2. Retire the shims after the repair publishes: `@orkestrel/ollama`'s `normalizeSchemaTypes` in `tests/setupStore.ts` (it rewrites a type array to `anyOf` before counting malformed calls); `@orkestrel/browser`'s `edit` tool advertises its `edits` parameter as `anyOf` of an array and a string, which stays valid JSON Schema either way and can stay.

## Gates

The contract repository's own gates, then a `scaffold repair` visit is not needed: the package is a runtime dependency, so each consumer takes the fix at its next range bump.
