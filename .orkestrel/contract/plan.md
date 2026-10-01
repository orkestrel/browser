# Contract plan: the schema reader and a JSON Schema type array

Scaffold's `ROADMAP.md` item 37 carries this work. The `orkestrel/contract` repository was outside the session that found it; attach it before the unit.

## Finding

`@orkestrel/contract` 0.0.18 reads a JSON Schema `type` array such as `['array', 'string']` as a shape that accepts any value. The reader is the `SchemaShaper` class in `dist/src/core/index.js`, which takes `isString(schema.type) ? schema.type : undefined` and matches no branch for an array, so `schemaToShape` returns an unconstrained shape. Measured 2026-10-01 against the installed 0.0.18 in `/home/user/browser` and `/home/user/ollama`: `edits: 3` passed a schema that declared `type: ['array', 'string']`.

## Units

1. **The reader** (`astra`): read a `type` array as the union of its members (the shape `anyOf` of one schema per type produces), with a test per member count, a test that the array member keeps its `items` and the object member its `properties`, and a negative control that refuses a value outside the union; state the accepted forms in the contract guide's schema section. Bump by the package's rule and publish.
2. **The shims, after the repair publishes**: `@orkestrel/ollama`'s `normalizeSchemaTypes` in `tests/setupStore.ts` goes (it rewrites a type array to `anyOf` before counting malformed calls); `@orkestrel/browser`'s `edit` tool advertises its `edits` parameter as `anyOf` of an array and a string, which stays valid JSON Schema either way and can stay.

## Gates

The contract repository's own `npm test`; no `scaffold repair` visit, because the package is a runtime dependency and each consumer takes the fix at its next range bump.
