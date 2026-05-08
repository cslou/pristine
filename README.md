# Pristine Local

Local-first privacy and source-pointer memory SDK. No server; no user data leaves the device by default. The default local embedder may download model files on first use unless pre-cached or configured offline.

Pristine indexes source-owned text chunks with local embeddings and returns semantic search hits containing snippets plus optional source pointers. The source system remains authoritative for full raw transcripts/files/events; Pristine stores indexed chunk text/snippets, embeddings, source metadata, and privacy vault data in a local SQLite database.

## Install

```bash
npm install @pristine/shield-local
```

## Quick start

```ts
import { PristineLocal } from '@pristine/shield-local';

const client = await PristineLocal.create();

await client.indexSourceChunks(
  [
    {
      text: 'Pi JSONL source pointer architecture cleanup notes',
      chunkId: 'session-1:line-42',
      sourceKind: 'pi-jsonl',
      sourceUri: 'file:///Users/me/.pi/agent/sessions/session.jsonl',
      lineNumber: 42,
      metadata: { cwd: '/Users/me/project' },
    },
  ],
  { projectId: 'my-project' },
);

const hits = await client.searchSourceChunks('source pointer cleanup', {
  projectId: 'my-project',
  limit: 5,
});

console.log(hits[0]);
// {
//   chunkId: 'session-1:line-42',
//   projectId: 'my-project',
//   text: 'Pi JSONL source pointer architecture cleanup notes',
//   score: 0.91,
//   sourceKind: 'pi-jsonl',
//   sourceUri: 'file:///Users/me/.pi/agent/sessions/session.jsonl',
//   lineNumber: 42,
//   ...
// }
```

## Core API

### `PristineLocal.create(config?)`

Creates a local client. Pass `db` and `embedder` for deterministic tests, or omit them to use the default local SQLite database and in-process local embedder.

### `indexSourceChunks(chunks, { projectId })`

Indexes source-owned chunks. `text` is required; all source metadata is optional. Duplicate `(projectId, chunkId)` values replace the existing chunk and vector atomically. If `chunkId` is omitted, Pristine generates one.

### `searchSourceChunks(query, { projectId, limit? })`

Runs vector search over indexed chunks and returns pointer-oriented hits. Results include `chunkId`, indexed text, score, nullable source fields, and metadata. Search is project-scoped and does not require raw conversation/message tables.

### `deleteSourceChunks(chunkIds, { projectId })`

Deletes source chunks and their vector rows atomically within one project. Use this when the authoritative source system deletes, truncates, rotates, or supersedes records so Pristine does not return stale pointers/snippets.

### Privacy APIs

- `secureAndRedact(text, userId, classifier?)`
- `reveal(redactedText, userId)`
- `scrubOutput(text, allowlist?)`

These remain local-only and use the SQLite vault plus filesystem keys.

## Source chunk shape

```ts
interface SourceChunkInput {
  text: string;
  chunkId?: string;
  sourceKind?: string;
  sourceUri?: string;
  entryId?: string;
  parentId?: string;
  lineNumber?: number;
  lineStart?: number;
  lineEnd?: number;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}
```

Metadata must be a JSON-serializable object up to 16 KiB. Text must be non-empty after trimming.

## Local-first guarantees

- Embeddings run locally through the configured embedder.
- Indexed chunk text/snippets, embeddings, metadata, and vault entries are stored in a local SQLite file.
- No user data is sent to an API by default. The default Transformers-based embedder may download model files from Hugging Face on first use unless the model is already cached or an offline/local embedder is configured.
- Full raw source records remain in the calling harness/source system.

## Verification

Common local checks:

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:smoke
SKIP_SLOW_TESTS=1 npm run test:integration
npm run test:e2e
npm run build
```

Full real-model source-index smoke after build:

```bash
node scripts/smoke-source-index.mjs
```
