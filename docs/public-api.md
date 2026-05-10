# Public API Surface

This document records the supported root package surface for `@pristine/shield-local` public alpha.

## Supported root value exports

These names are runtime exports from the package root and are covered by smoke tests against `dist/index.js`.

| Export | Status | Purpose |
| --- | --- | --- |
| `PristineLocal` | Supported | Main local SDK client. |
| `createDatabase` | Supported | Create/open a SQLite database with the repo's sqlite-vec loading behavior. |
| `AppError` | Supported | Base domain error class. |
| `ConfigError` | Supported | Configuration error class. |
| `EmbedderError` | Supported | Embedder failure class. |
| `InvalidArgumentError` | Supported | Public validation error class. |
| `SOURCE_CHUNK_METADATA_JSON_LIMIT` | Supported | Source chunk metadata size limit. |
| `SOURCE_CHUNK_TEXT_LIMIT` | Supported | Source chunk text size limit. |
| `SourceChunkStore` | Supported low-level primitive | Source-index store for advanced local integrations and tests. |
| `buildSourceChunkVectorDdl` | Supported low-level primitive | Builds source chunk vector table DDL for the configured dimension. |
| `initSourceChunkTables` | Supported low-level primitive | Initializes source chunk tables owned by the source-index module. |
| `normalizeSourceChunkInput` | Supported low-level primitive | Validates/normalizes source chunk input. |

## Supported root type exports

These TypeScript-only exports are part of the package root typing contract:

- `DeleteSourceChunksOptions`
- `DeleteSourceChunksResult`
- `DeterministicClassifierConfig`
- `Embedder`
- `IndexedSourceChunk`
- `IndexSourceChunksOptions`
- `PristineLocalConfig`
- `RevealResult`
- `SearchSourceChunksOptions`
- `SecureAndRedactResult`
- `SourceChunkInput`
- `SourceChunkMetadata`
- `SourceChunkNormalizeOptions`
- `SourceChunkSearchHit`
- `SourceChunkSearchOptions`
- `SourceChunkStoreOptions`
- `StoredSourceChunk`

## Intentionally internal

The package root does not export raw conversation storage, ingest queues, worker drains, SQL searchers, provider SDK clients, or benchmark-only helpers. Consumers should compose the supported source chunk and privacy primitives instead of importing internal paths.

## Deferred

Possible future additions, such as a source-index-only SQL/debug primitive or higher-level agent adapters, require a reviewed design, tests, README updates, and CHANGELOG notes before becoming public API.
